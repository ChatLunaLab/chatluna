import { Context } from 'koishi'
import {
    AIMessage,
    BaseMessage,
    FunctionMessage,
    HumanMessage,
    mapStoredMessageToChatMessage,
    MessageContent,
    SystemMessage,
    ToolMessage
} from '@langchain/core/messages'
import { BaseChatMessageHistory } from '@langchain/core/chat_history'
import {
    bufferToArrayBuffer,
    gzipDecode,
    gzipEncode
} from 'koishi-plugin-chatluna/utils/string'
import { randomUUID } from 'crypto'
import type { ChatLunaMessageMeta, MessageRecord } from '../../../types'
import type { ChatLunaService } from '../../../services/chat'
import type {
    CompactionMetadata,
    CompactionResult
} from '../../chat/compaction'

export class KoishiChatMessageHistory extends BaseChatMessageHistory {
    // eslint-disable-next-line @typescript-eslint/naming-convention
    lc_namespace: string[] = ['llm-core', 'memory', 'message']

    conversationId: string

    private _ctx: Context
    private _latestId: string | null
    private _serializedChatHistory: MessageRecord[]
    private _chatHistory: BaseMessage[]
    // eslint-disable-next-line @typescript-eslint/naming-convention
    private _additional_kwargs: Record<string, string>
    private _updatedAt: Date
    constructor(
        ctx: Context,
        conversationId: string,
        private readonly chatluna: ChatLunaService
    ) {
        super()

        this.conversationId = conversationId
        this._ctx = ctx
        this._chatHistory = []
        this._additional_kwargs = {}
        this._updatedAt = new Date(0)
    }

    // eslint-disable-next-line @typescript-eslint/naming-convention
    get additionalArgs() {
        return this._additional_kwargs
    }

    async getMessages(): Promise<BaseMessage[]> {
        await this.loadConversation()
        const latestUpdateTime = await this.getLatestUpdateTime()

        if (
            latestUpdateTime > this._updatedAt ||
            this._chatHistory.length === 0
        ) {
            await this._loadConversation()
            this._chatHistory = await this._loadMessages()
            this._updatedAt = latestUpdateTime
        }

        return this._projectMessages()
    }

    async addUserMessage(message: string): Promise<void> {
        const humanMessage = new HumanMessage(message)
        await this.addMessage(humanMessage)
    }

    async addAIChatMessage(message: string): Promise<void> {
        const aiMessage = new AIMessage(message)
        await this.addMessage(aiMessage)
    }

    async addMessage(message: BaseMessage): Promise<void> {
        await this.addMessages([message])
    }

    async addMessages(messages: BaseMessage[]): Promise<void> {
        if (messages.length === 0) {
            return
        }

        await this.getMessages()

        const serializedMessages: MessageRecord[] = []
        let parentId = this._latestId
        const recordIds = new Map<string, string>()
        const appendedMessages: BaseMessage[] = []

        for (const sourceMessage of messages) {
            const sourceMeta = readMessageMeta(sourceMessage)
            const message =
                sourceMeta.conversationId &&
                sourceMeta.conversationId !== this.conversationId
                    ? mapStoredMessageToChatMessage(sourceMessage.toDict())
                    : sourceMessage
            if (message !== sourceMessage) {
                message.response_metadata = { ...message.response_metadata }
            }
            const oldRecordId = sourceMeta.recordId
            const compaction = message.response_metadata?.compaction as
                CompactionMetadata | undefined
            if (compaction?.through && recordIds.has(compaction.through)) {
                message.response_metadata.compaction = {
                    ...compaction,
                    through: recordIds.get(compaction.through)
                }
            }
            const serializedMessage = await serializeMessage(
                message,
                this.conversationId,
                parentId
            )
            serializedMessages.push(serializedMessage)
            if (oldRecordId) {
                recordIds.set(oldRecordId, serializedMessage.id)
            }
            parentId = serializedMessage.id
            appendedMessages.push(message)
        }

        await this._ctx.database.upsert('chatluna_message', serializedMessages)

        this._serializedChatHistory.push(...serializedMessages)
        this._chatHistory.push(...appendedMessages)
        this._latestId = serializedMessages[serializedMessages.length - 1].id

        const updatedAt = new Date()

        this._updatedAt = updatedAt

        await this._saveConversation(updatedAt)
    }

    async compact(result: CompactionResult): Promise<void> {
        if (!result.compressed || !result.summary) return

        await this.getMessages()
        const lastRemoved = result.removed?.[result.removed.length - 1]
        const previous = lastRemoved?.response_metadata?.compaction as
            CompactionMetadata | undefined
        const through =
            previous?.through ??
            (lastRemoved && readMessageMeta(lastRemoved).recordId)
        if (
            !through ||
            !this._serializedChatHistory.some((row) => row.id === through)
        ) {
            throw new Error(
                'Compaction boundary must reference persisted history'
            )
        }

        result.summary.response_metadata.compaction = {
            ...result.summary.response_metadata.compaction,
            through
        }
        await this.addMessage(result.summary)
    }

    private _projectMessages(): BaseMessage[] {
        const originals = this._chatHistory.filter(
            (message) => !message.response_metadata?.compaction
        )
        for (let i = this._chatHistory.length - 1; i >= 0; i--) {
            const summary = this._chatHistory[i]
            const compaction = summary.response_metadata?.compaction as
                CompactionMetadata | undefined
            if (!compaction?.through) continue
            const boundary = originals.findIndex(
                (message) =>
                    readMessageMeta(message).recordId === compaction.through
            )
            if (boundary < 0) continue
            const boundaryPosition = this._chatHistory.indexOf(
                originals[boundary]
            )
            if (boundaryPosition >= i) continue
            return [summary, ...originals.slice(boundary + 1)]
        }
        return originals
    }

    async clear(): Promise<void> {
        await this._ctx.database.remove('chatluna_message', {
            conversationId: this.conversationId
        })

        await this._ctx.database.upsert('chatluna_conversation', [
            {
                id: this.conversationId,
                latestMessageId: null,
                updatedAt: new Date()
            }
        ])

        this._serializedChatHistory = []
        this._chatHistory = []
        this._latestId = null
    }

    async delete(): Promise<void> {
        await this._ctx.database.remove('chatluna_conversation', {
            id: this.conversationId
        })
    }

    async updateAdditionalArg(key: string, value: string): Promise<void> {
        await this.loadConversation()
        this._additional_kwargs[key] = value
        await this._saveConversation()
    }

    async getAdditionalArg(key: string): Promise<string> {
        await this.loadConversation()

        return this._additional_kwargs[key]
    }

    async getAdditionalArgs(): Promise<{ [key: string]: string }> {
        await this.loadConversation()
        return this._additional_kwargs
    }

    async deleteAdditionalArg(key: string): Promise<void> {
        await this.loadConversation()
        delete this._additional_kwargs[key]
        await this._saveConversation()
    }

    async overrideAdditionalArgs(kwargs: {
        [key: string]: string
    }): Promise<void> {
        await this.loadConversation()
        this._additional_kwargs = Object.assign(this._additional_kwargs, kwargs)
        await this._saveConversation()
    }

    private async getLatestUpdateTime(): Promise<Date> {
        const conversation = (
            await this._ctx.database.get(
                'chatluna_conversation',
                {
                    id: this.conversationId
                },
                ['updatedAt']
            )
        )?.[0]

        return conversation?.updatedAt ?? new Date(0)
    }

    private async _loadMessages(): Promise<BaseMessage[]> {
        const queried = await this._ctx.database.get('chatluna_message', {
            conversationId: this.conversationId
        })

        const sorted: MessageRecord[] = []

        let currentMessageId = this._latestId

        let isBad = false
        const seen = new Set<string>()

        if (currentMessageId == null && queried.length > 0) {
            isBad = true
        }

        while (currentMessageId != null && !isBad) {
            if (seen.has(currentMessageId)) {
                isBad = true
                break
            }

            seen.add(currentMessageId)

            const currentMessage = queried.find(
                (item) => item.id === currentMessageId
            )

            if (!currentMessage) {
                isBad = true
                break
            }

            sorted.unshift(currentMessage)

            currentMessageId = currentMessage.parentId
        }

        if (isBad) {
            this._ctx.logger.warn(
                `Bad conversation detected for %s`,
                this.conversationId
            )

            sorted.length = 0

            await this.clear()
        }

        this._serializedChatHistory = sorted

        const promises = sorted.map(async (item) => {
            // eslint-disable-next-line @typescript-eslint/naming-convention
            const args = JSON.parse(
                item.additional_kwargs_binary
                    ? await gzipDecode(item.additional_kwargs_binary)
                    : '{}'
            )
            const responseMetadata = JSON.parse(
                item.response_metadata_binary
                    ? await gzipDecode(item.response_metadata_binary)
                    : '{}'
            )

            responseMetadata.chatluna = {
                ...(responseMetadata.chatluna ?? {}),
                recordId: item.id,
                conversationId: this.conversationId,
                createdAt: item.createdAt?.toISOString()
            }

            let content: MessageContent
            try {
                content = JSON.parse(
                    item.content
                        ? await gzipDecode(item.content)
                        : (item.text as string)
                ) as MessageContent
            } catch {
                this._ctx.logger.warn(
                    `Failed to deserialize message content for %s in %s, using fallback text.`,
                    item.id,
                    this.conversationId
                )
                content =
                    typeof item.text === 'string'
                        ? (item.text as MessageContent)
                        : ('' as MessageContent)
            }
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const fields = {
                content,
                id: item.rawId ?? undefined,
                name: item.name ?? undefined,
                tool_calls:
                    (item.tool_calls as AIMessage['tool_calls']) ?? undefined,
                tool_call_id: item.tool_call_id ?? undefined,
                response_metadata: responseMetadata,
                usage_metadata: responseMetadata.chatluna?.usage,
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                additional_kwargs: args as any
            }
            if (item.role === 'system') {
                return new SystemMessage(fields)
            } else if (item.role === 'human') {
                return new HumanMessage(fields)
            } else if (item.role === 'ai') {
                return new AIMessage(fields)
            } else if (item.role === 'function') {
                return new FunctionMessage(fields)
            } else if (item.role === 'tool') {
                return new ToolMessage(fields)
            } else {
                throw new Error('Unknown role')
            }
        })

        return await Promise.all(promises)
    }

    private async _loadConversation() {
        const conversation = (
            await this._ctx.database.get('chatluna_conversation', {
                id: this.conversationId
            })
        )?.[0]

        if (conversation) {
            this._latestId = conversation.latestMessageId ?? null
            this._additional_kwargs =
                conversation.additional_kwargs != null
                    ? JSON.parse(conversation.additional_kwargs)
                    : {}
        } else {
            await this._ctx.database.create('chatluna_conversation', {
                id: this.conversationId,
                bindingKey: this.conversationId,
                title: 'Conversation',
                model: this.chatluna.config.defaultModel,
                preset: this.chatluna.config.defaultPreset,
                chatMode: this.chatluna.config.defaultChatMode,
                createdBy: 'system',
                createdAt: new Date(),
                updatedAt: new Date(),
                lastChatAt: new Date(),
                status: 'active',
                latestMessageId: null,
                additional_kwargs: null,
                compression: null,
                archivedAt: null,
                archiveId: null,
                legacyRoomId: null,
                legacyMeta: null,
                autoTitle: true
            })
        }

        if (!this._serializedChatHistory) {
            this._chatHistory = await this._loadMessages()
            this._updatedAt = conversation?.updatedAt ?? new Date(0)
        }
    }

    async loadConversation() {
        if (!this._serializedChatHistory) {
            await this._loadConversation()
        }
    }

    private async _saveConversation(time: Date = new Date()) {
        const hasKwargs =
            this._additional_kwargs &&
            Object.keys(this._additional_kwargs).length > 0

        await this._ctx.database.upsert('chatluna_conversation', [
            {
                id: this.conversationId,
                latestMessageId: this._latestId,
                additional_kwargs: hasKwargs
                    ? JSON.stringify(this._additional_kwargs)
                    : null,
                updatedAt: time
            }
        ])
    }
}

async function serializeMessage(
    message: BaseMessage,
    conversationId: string,
    parentId?: string | null
): Promise<MessageRecord> {
    const meta = readMessageMeta(message)
    const id =
        meta.conversationId === conversationId
            ? (meta.recordId ?? randomUUID())
            : randomUUID()
    const createdAt = meta.createdAt ? new Date(meta.createdAt) : new Date()

    writeMessageMeta(message, {
        recordId: id,
        conversationId,
        ...(message.getType() === 'ai'
            ? { usage: (message as AIMessage).usage_metadata }
            : {}),
        createdAt: createdAt.toISOString()
    })

    let additionalArgs = Object.assign({}, message.additional_kwargs)

    delete additionalArgs['preset']
    delete additionalArgs['raw_content']
    delete additionalArgs['type']

    if (Object.keys(additionalArgs).length === 0) {
        additionalArgs = null
    }

    let responseMetadata = Object.assign({}, message.response_metadata)

    if (Object.keys(responseMetadata).length === 0) {
        responseMetadata = null
    }

    return {
        id,
        content: await gzipEncode(JSON.stringify(message.content)).then((buf) =>
            bufferToArrayBuffer(buf)
        ),
        parentId: parentId ?? null,
        role: message.getType(),
        name: message.name,
        tool_calls:
            message instanceof AIMessage ? message.tool_calls : undefined,
        tool_call_id:
            message instanceof ToolMessage ? message.tool_call_id : undefined,
        additional_kwargs_binary:
            additionalArgs && Object.keys(additionalArgs).length > 0
                ? await gzipEncode(JSON.stringify(additionalArgs)).then((buf) =>
                      bufferToArrayBuffer(buf)
                  )
                : null,
        response_metadata_binary:
            responseMetadata && Object.keys(responseMetadata).length > 0
                ? await gzipEncode(JSON.stringify(responseMetadata)).then(
                      (buf) => bufferToArrayBuffer(buf)
                  )
                : null,
        rawId: message.id ?? null,
        conversationId,
        createdAt
    }
}

function readMessageMeta(message: BaseMessage) {
    const meta = message.response_metadata?.chatluna as
        ChatLunaMessageMeta | undefined

    return {
        recordId:
            typeof meta?.recordId === 'string' && meta.recordId.length > 0
                ? meta.recordId
                : undefined,
        createdAt:
            typeof meta?.createdAt === 'string' && meta.createdAt.length > 0
                ? meta.createdAt
                : undefined,
        conversationId: meta?.conversationId
    }
}

function writeMessageMeta(message: BaseMessage, meta: ChatLunaMessageMeta) {
    message.response_metadata = {
        ...(message.response_metadata ?? {}),
        chatluna: {
            ...((message.response_metadata?.chatluna as ChatLunaMessageMeta) ??
                {}),
            ...meta
        }
    }
}
