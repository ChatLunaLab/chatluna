import { AIMessage, HumanMessage } from '@langchain/core/messages'
import type { Session } from 'koishi'
import { LRUCache } from 'lru-cache'
import { MessageQueue, type ToolMask } from '../llm-core/agent/types'
import { RequestIdQueue } from 'koishi-plugin-chatluna/utils/queue'
import { randomUUID } from 'crypto'
import type { ChatLunaService } from './chat'
import {
    ChatLunaError,
    ChatLunaErrorCode
} from 'koishi-plugin-chatluna/utils/error'
import { parseRawModelName } from '../utils/model'
import { ConversationRecord } from './conversation_types'
import { Message } from '../types'
import type { PostHandler } from '../utils/types'
import { ActiveRequest, ChatEvents, RuntimeConversationEntry } from './types'
import { type UsageMetadata } from '@langchain/core/messages'

export class ConversationRuntime {
    readonly interfaces = new LRUCache<string, RuntimeConversationEntry>({
        max: 20,
        dispose: (value) => {
            value.chatInterface.dispose?.()
        }
    })

    readonly modelQueue = new RequestIdQueue()
    readonly conversationQueue = new RequestIdQueue()
    readonly activeByConversation = new Map<string, ActiveRequest>()

    constructor(private readonly service: ChatLunaService) {}

    private get platformService() {
        return this.service.platform
    }

    async ensureChatInterface(conversation: ConversationRecord) {
        const cached = this.interfaces.get(conversation.id)
        if (cached != null) {
            cached.conversation = conversation
            return cached.chatInterface
        }

        const chatInterface =
            await this.service.createChatInterface(conversation)
        this.interfaces.set(conversation.id, {
            conversation,
            chatInterface
        })
        return chatInterface
    }

    async chat(
        session: Session,
        conversation: ConversationRecord,
        message: Message,
        event: ChatEvents,
        stream: boolean = false,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        variables: Record<string, any> = {},
        postHandler?: PostHandler,
        requestId: string = randomUUID(),
        toolMask?: ToolMask
    ): Promise<Message> {
        return this.withConversationAndPlatformLock(conversation, async () => {
            const [platform] = parseRawModelName(conversation.model)
            if (platform == null) {
                throw new ChatLunaError(
                    ChatLunaErrorCode.UNKNOWN_ERROR,
                    new Error(
                        `Invalid conversation model: ${conversation.model}`
                    )
                )
            }

            const chatInterface = await this.ensureChatInterface(conversation)
            const abortController = new AbortController()
            const activeRequest = this.registerRequest(
                conversation.id,
                requestId,
                conversation.chatMode,
                platform,
                abortController,
                session
            )

            try {
                const humanMessage = new HumanMessage({
                    content: message.content,
                    name: message.name,
                    id: session.userId,
                    additional_kwargs: {
                        ...message.additional_kwargs,
                        preset: conversation.preset
                    }
                })

                const mask =
                    toolMask ??
                    (await this.platformService.resolveToolMask({
                        session,
                        conversation,
                        bindingKey: conversation.bindingKey
                    }))

                const chainValues = await chatInterface.chat({
                    message: humanMessage,
                    events: event,
                    stream,
                    conversationId: conversation.id,
                    requestId,
                    session,
                    variables,
                    signal: abortController.signal,
                    postHandler,
                    messageQueue: activeRequest.messageQueue,
                    toolMask: mask,
                    onAgentEvent: async (agentEvent) => {
                        if (agentEvent.type === 'round-decision') {
                            activeRequest.lastDecision = agentEvent.canContinue
                            if (agentEvent.canContinue == null) {
                                return
                            }

                            for (const resolve of activeRequest.roundDecisionResolvers) {
                                resolve(agentEvent.canContinue)
                            }
                            activeRequest.roundDecisionResolvers = []
                        }
                    }
                })

                const aiMessage = chainValues.message as AIMessage
                const reasoningContent = aiMessage.additional_kwargs
                    ?.reasoning_content as string
                const reasoningTime = aiMessage.additional_kwargs
                    ?.reasoning_time as number
                const usageMetadata = aiMessage.usage_metadata
                const additionalReplyMessages: Message[] = []

                if (
                    reasoningContent != null &&
                    reasoningContent.length > 0 &&
                    this.service.currentConfig.showThoughtMessage
                ) {
                    additionalReplyMessages.push({
                        content:
                            reasoningTime != null
                                ? `Thought for ${reasoningTime / 1000} seconds: \n\n${reasoningContent}`
                                : `Thought: \n\n${reasoningContent}`
                    })
                }

                if (
                    usageMetadata != null &&
                    usageMetadata.total_tokens > 0 &&
                    this.service.currentConfig.showThoughtMessage
                ) {
                    additionalReplyMessages.push({
                        content: formatUsageMetadataMessage(usageMetadata)
                    })
                }

                return {
                    content: aiMessage.content as string,
                    additional_kwargs: aiMessage.additional_kwargs,
                    additionalReplyMessages
                }
            } finally {
                this.completeRequest(conversation.id, requestId)
            }
        })
    }

    updateConversationRecord(conversation: ConversationRecord) {
        const cached = this.interfaces.get(conversation.id)
        if (cached != null) {
            cached.conversation = conversation
        }
    }

    getCachedConversations(): [string, RuntimeConversationEntry][] {
        return Array.from(this.interfaces.entries())
    }

    async withConversationLock<T>(
        conversationId: string,
        callback: () => Promise<T>
    ): Promise<T> {
        const requestId = randomUUID()
        try {
            await this.conversationQueue.add(conversationId, requestId)
            await this.conversationQueue.wait(conversationId, requestId, 0)
            return await callback()
        } finally {
            await this.conversationQueue.remove(conversationId, requestId)
        }
    }

    async withConversationSync<T>(
        conversation: ConversationRecord,
        callback: () => Promise<T>
    ): Promise<T> {
        const requestId = randomUUID()
        try {
            await this.conversationQueue.add(conversation.id, requestId)
            this.stopConversationRequest(conversation.id)
            await this.conversationQueue.wait(conversation.id, requestId, 0)
            return await callback()
        } finally {
            await this.conversationQueue.remove(conversation.id, requestId)
        }
    }

    async withConversationAndPlatformLock<T>(
        conversation: ConversationRecord,
        callback: () => Promise<T>
    ): Promise<T> {
        const requestId = randomUUID()
        const modelRequestId = randomUUID()
        const [platform] = parseRawModelName(conversation.model)
        if (platform == null) {
            throw new ChatLunaError(
                ChatLunaErrorCode.UNKNOWN_ERROR,
                new Error(`Invalid conversation model: ${conversation.model}`)
            )
        }
        const client = await this.platformService.getClient(platform)

        if (client.value == null) {
            await this.service.awaitLoadPlatform(platform)
        }

        if (client.value == null) {
            throw new ChatLunaError(
                ChatLunaErrorCode.UNKNOWN_ERROR,
                new Error(`Platform ${platform} is not available`)
            )
        }

        const config = client.value.configPool.getConfig(true).value

        try {
            await Promise.all([
                this.conversationQueue.add(conversation.id, requestId),
                this.modelQueue.add(platform, modelRequestId)
            ])

            await Promise.all([
                this.conversationQueue.wait(conversation.id, requestId, 0),
                this.modelQueue.wait(
                    platform,
                    modelRequestId,
                    config.concurrentMaxSize
                )
            ])

            return await callback()
        } finally {
            await Promise.all([
                this.conversationQueue.remove(conversation.id, requestId),
                this.modelQueue.remove(platform, modelRequestId)
            ])
        }
    }

    registerRequest(
        conversationId: string,
        requestId: string,
        chatMode: string,
        platform: string,
        abortController: AbortController,
        session?: Session
    ) {
        const activeRequest: ActiveRequest = {
            requestId,
            conversationId,
            requestKey:
                session == null
                    ? undefined
                    : JSON.stringify([
                          session.userId,
                          session.guildId ?? '',
                          conversationId
                      ]),
            platform,
            abortController,
            chatMode,
            messageQueue: new MessageQueue(),
            roundDecisionResolvers: []
        }

        this.activeByConversation.set(conversationId, activeRequest)
        return activeRequest
    }

    completeRequest(conversationId: string, requestId: string) {
        const active = this.activeByConversation.get(conversationId)
        if (active?.requestId === requestId) {
            for (const resolve of active.roundDecisionResolvers) {
                resolve(false)
            }
            this.activeByConversation.delete(conversationId)
        }
    }

    stopRequest(requestId: string) {
        const active = Array.from(this.activeByConversation.values()).find(
            (item) => item.requestId === requestId
        )
        if (active == null) {
            return false
        }
        if (active.abortController.signal.aborted) {
            return false
        }
        active.abortController.abort(
            new ChatLunaError(ChatLunaErrorCode.ABORTED, undefined, true)
        )
        return true
    }

    stopConversationRequest(conversationId: string) {
        const activeRequest = this.activeByConversation.get(conversationId)
        if (activeRequest == null) {
            return false
        }

        return this.stopRequest(activeRequest.requestId)
    }

    getRequestId(session: Session, conversationId: string) {
        const active = this.activeByConversation.get(conversationId)
        if (active == null) {
            return undefined
        }
        if (
            active.requestKey !==
            JSON.stringify([
                session.userId,
                session.guildId ?? '',
                conversationId
            ])
        ) {
            return undefined
        }
        return active.requestId
    }

    async appendPendingMessage(
        conversationId: string,
        message: HumanMessage,
        chatMode?: string
    ): Promise<boolean> {
        if (chatMode != null && chatMode !== 'plugin') {
            return false
        }

        const activeRequest = this.activeByConversation.get(conversationId)

        if (activeRequest == null || activeRequest.chatMode !== 'plugin') {
            return false
        }

        if (activeRequest.lastDecision != null) {
            if (activeRequest.lastDecision) {
                activeRequest.messageQueue.push(message)
            }
            return activeRequest.lastDecision
        }

        return new Promise((resolve) => {
            activeRequest.roundDecisionResolvers.push((canContinue) => {
                if (canContinue) {
                    activeRequest.messageQueue.push(message)
                }
                resolve(canContinue)
            })
        })
    }

    async clearConversationCache(conversationId: string) {
        return this.interfaces.delete(conversationId)
    }

    async clearConversationHistory(conversation: ConversationRecord) {
        return this.withConversationLock(conversation.id, async () => {
            const chatInterface = await this.ensureChatInterface(conversation)
            await this.service.ctx.root.parallel(
                'chatluna/conversation-before-clear-history',
                {
                    conversation,
                    chatInterface
                }
            )
            await this.service.ctx.root.parallel(
                'chatluna/clear-chat-history',
                conversation.id,
                chatInterface
            )
            await chatInterface.clearChatHistory()
            this.interfaces.delete(conversation.id)
            await this.service.ctx.root.parallel(
                'chatluna/conversation-after-clear-history',
                {
                    conversation,
                    chatInterface
                }
            )
        })
    }

    async compressConversation(
        conversation: ConversationRecord,
        force = false
    ) {
        return this.withConversationAndPlatformLock(conversation, async () => {
            const chatInterface = await this.ensureChatInterface(conversation)
            return await chatInterface.compressContext(force)
        })
    }

    async clearConversationInterfaceLocked(conversation: ConversationRecord) {
        const cached = this.interfaces.get(conversation.id)
        const existed = cached != null
        await this.service.ctx.root.parallel(
            'chatluna/conversation-before-cache-clear',
            {
                conversation,
                chatInterface: cached?.chatInterface
            }
        )
        this.interfaces.delete(conversation.id)
        await this.service.ctx.root.parallel(
            'chatluna/conversation-after-cache-clear',
            {
                conversation
            }
        )
        return existed
    }

    async clearConversationInterface(conversation: ConversationRecord) {
        return this.withConversationLock(conversation.id, async () => {
            return this.clearConversationInterfaceLocked(conversation)
        })
    }

    dispose(platform?: string) {
        if (platform == null) {
            for (const active of Array.from(
                this.activeByConversation.values()
            )) {
                active.abortController.abort(
                    new ChatLunaError(
                        ChatLunaErrorCode.ABORTED,
                        undefined,
                        true
                    )
                )
            }
            this.interfaces.clear()
            this.activeByConversation.clear()
            return
        }

        for (const active of Array.from(this.activeByConversation.values())) {
            if (active.platform === platform) {
                active.abortController.abort(
                    new ChatLunaError(
                        ChatLunaErrorCode.ABORTED,
                        undefined,
                        true
                    )
                )
                this.activeByConversation.delete(active.conversationId)
                this.interfaces.delete(active.conversationId)
            }
        }

        for (const [conversationId, entry] of Array.from(
            this.interfaces.entries()
        )) {
            if (parseRawModelName(entry.conversation.model)[0] === platform) {
                this.interfaces.delete(conversationId)
            }
        }
    }
}

function formatUsageMetadataMessage(usage: UsageMetadata) {
    const input = [
        ...(usage.input_token_details?.audio != null &&
        usage.input_token_details?.audio > 0
            ? [`audio=${usage.input_token_details.audio}`]
            : []),
        ...(usage.input_token_details?.image != null &&
        usage.input_token_details?.image > 0
            ? [`image=${usage.input_token_details.image}`]
            : []),
        ...(usage.input_token_details?.cache_read != null
            ? [`cache_read=${usage.input_token_details.cache_read}`]
            : []),
        ...(usage.input_token_details?.cache_creation != null
            ? [`cache_creation=${usage.input_token_details.cache_creation}`]
            : [])
    ]
    const output = [
        ...(usage.output_token_details?.audio != null &&
        usage.output_token_details?.audio > 0
            ? [`audio=${usage.output_token_details.audio}`]
            : []),
        ...(usage.output_token_details?.image != null &&
        usage.output_token_details?.image > 0
            ? [`image=${usage.output_token_details.image}`]
            : []),
        ...(usage.output_token_details?.reasoning != null
            ? [`reasoning=${usage.output_token_details.reasoning}`]
            : [])
    ]

    return [
        'Token usage:',
        `- input: ${usage.input_tokens}`,
        `- output: ${usage.output_tokens}`,
        `- total: ${usage.total_tokens}`,
        ...(input.length > 0 ? [`- input details: ${input.join(', ')}`] : []),
        ...(output.length > 0 ? [`- output details: ${output.join(', ')}`] : [])
    ].join('\n')
}

export type {
    ChatEvents,
    RuntimeConversationEntry,
    ActiveRequest
} from './types'
