import {
    AIMessage,
    BaseMessageChunk,
    HumanMessage
} from '@langchain/core/messages'
import type { Session } from 'koishi'
import { LRUCache } from 'lru-cache'
import type { ChatInterface } from '../llm-core/chat/app'
import {
    type AgentAction,
    MessageQueue,
    type ToolMask
} from '../llm-core/agent/types'
import { RequestIdQueue } from '../utils/queue'
import { randomUUID } from 'crypto'
import type { ChatLunaService } from './chat'
import { ChatLunaError, ChatLunaErrorCode } from '../utils/error'
import { parseRawModelName } from '../utils/model'
import { ConversationRecord } from './conversation_types'
import { Message } from '../types'
import type { PostHandler } from '../utils/types'

export interface ChatEvents {
    'llm-new-token'?: (token: string) => Promise<void>
    'llm-queue-waiting'?: (size: number) => Promise<void>
    'llm-used-token-count'?: (token: number) => Promise<void>
    'llm-call-tool'?: (
        tool: string,
        args: any,
        content: AgentAction['content'],
        log: string
    ) => Promise<void>
    'llm-new-chunk'?: (chunk: BaseMessageChunk) => Promise<void>
}

export interface RuntimeConversationEntry {
    conversation: ConversationRecord
    chatInterface: ChatInterface
}

export interface ActiveRequest {
    requestId: string
    conversationId: string
    sessionId?: string
    abortController: AbortController
    chatMode: string
    messageQueue: MessageQueue
    roundDecisionResolvers: ((canContinue: boolean) => void)[]
    lastDecision?: boolean
}

function createAbortError() {
    return new ChatLunaError(ChatLunaErrorCode.ABORTED, undefined, true)
}

export class ConversationRuntime {
    readonly interfaces = new LRUCache<string, RuntimeConversationEntry>({
        max: 20
    })

    readonly modelQueue = new RequestIdQueue()
    readonly conversationQueue = new RequestIdQueue()
    readonly requestsById = new Map<string, AbortController>()
    readonly activeByConversation = new Map<string, ActiveRequest>()
    readonly requestBySession = new Map<string, string>()
    readonly platformIndex = new Map<string, Set<string>>()

    constructor(private readonly service: ChatLunaService) {}

    private get platformService() {
        return this.service.platform
    }

    async ensureChatInterface(conversation: ConversationRecord) {
        const cached = this.interfaces.get(conversation.id)
        if (cached != null) {
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
            this.registerPlatformConversation(platform, conversation.id)

            const chatInterface = await this.ensureChatInterface(conversation)
            const abortController = new AbortController()
            const activeRequest = this.registerRequest(
                conversation.id,
                requestId,
                conversation.chatMode,
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
                    (await this.service.resolveToolMask({
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
                    additionalReplyMessages
                }
            } finally {
                this.completeRequest(conversation.id, requestId, session)
            }
        })
    }

    updateConversationRecord(conversation: ConversationRecord) {
        const cached = this.interfaces.get(conversation.id)
        if (cached != null) {
            cached.conversation = conversation
            this.interfaces.set(conversation.id, cached)
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

    async withConversationAndPlatformLock<T>(
        conversation: ConversationRecord,
        callback: () => Promise<T>
    ): Promise<T> {
        const requestId = randomUUID()
        const modelRequestId = randomUUID()
        const [platform] = parseRawModelName(conversation.model)
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

    registerPlatformConversation(platform: string, conversationId: string) {
        const values = this.platformIndex.get(platform) ?? new Set<string>()
        values.add(conversationId)
        this.platformIndex.set(platform, values)
    }

    unregisterPlatformConversation(platform: string, conversationId: string) {
        const values = this.platformIndex.get(platform)
        if (values == null) {
            return
        }
        values.delete(conversationId)
        if (values.size === 0) {
            this.platformIndex.delete(platform)
        }
    }

    registerRequest(
        conversationId: string,
        requestId: string,
        chatMode: string,
        abortController: AbortController,
        session?: Session
    ) {
        const activeRequest: ActiveRequest = {
            requestId,
            conversationId,
            sessionId: session?.sid,
            abortController,
            chatMode,
            messageQueue: new MessageQueue(),
            roundDecisionResolvers: []
        }

        this.requestsById.set(requestId, abortController)
        this.activeByConversation.set(conversationId, activeRequest)
        if (session?.sid != null) {
            this.requestBySession.set(session.sid, requestId)
        }
        return activeRequest
    }

    completeRequest(
        conversationId: string,
        requestId: string,
        session?: Session
    ) {
        this.requestsById.delete(requestId)
        if (session?.sid != null) {
            this.requestBySession.delete(session.sid)
        }

        const active = this.activeByConversation.get(conversationId)
        if (active?.requestId === requestId) {
            for (const resolve of active.roundDecisionResolvers) {
                resolve(false)
            }
            this.activeByConversation.delete(conversationId)
        }
    }

    stopRequest(requestId: string) {
        const abortController = this.requestsById.get(requestId)
        if (abortController == null) {
            return false
        }
        abortController.abort(createAbortError())
        this.requestsById.delete(requestId)
        return true
    }

    getRequestIdBySession(session: Session) {
        if (session.sid == null) {
            return undefined
        }
        return this.requestBySession.get(session.sid)
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
            chatInterface.dispose?.()
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

    async clearConversationInterface(conversation: ConversationRecord) {
        return this.withConversationLock(conversation.id, async () => {
            const cached = this.interfaces.get(conversation.id)
            const existed = cached != null
            await this.service.ctx.root.parallel(
                'chatluna/conversation-before-cache-clear',
                {
                    conversation,
                    chatInterface: cached?.chatInterface
                }
            )
            cached?.chatInterface?.dispose?.()
            this.interfaces.delete(conversation.id)
            await this.service.ctx.root.parallel(
                'chatluna/conversation-after-cache-clear',
                {
                    conversation
                }
            )
            return existed
        })
    }

    dispose(platform?: string) {
        for (const controller of this.requestsById.values()) {
            controller.abort(createAbortError())
        }

        if (platform == null) {
            for (const value of this.interfaces.values()) {
                value.chatInterface.dispose?.()
            }
            this.interfaces.clear()
            this.requestsById.clear()
            this.activeByConversation.clear()
            this.requestBySession.clear()
            this.platformIndex.clear()
            return
        }

        const conversationIds = this.platformIndex.get(platform)
        if (conversationIds == null) {
            return
        }

        for (const conversationId of conversationIds) {
            this.interfaces.get(conversationId)?.chatInterface.dispose?.()
            this.interfaces.delete(conversationId)
            this.activeByConversation.delete(conversationId)
        }

        this.platformIndex.delete(platform)
    }
}

function formatUsageMetadataMessage(usage: {
    input_tokens?: number
    output_tokens?: number
    total_tokens?: number
}) {
    return [
        'Token usage:',
        `- input: ${usage.input_tokens ?? 0}`,
        `- output: ${usage.output_tokens ?? 0}`,
        `- total: ${usage.total_tokens ?? 0}`
    ].join('\n')
}
