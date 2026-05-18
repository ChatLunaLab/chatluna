import type { Callbacks } from '@langchain/core/callbacks/manager'
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
import type { ClientConfig } from '../llm-core/platform/config'
import { markChatLunaUserMessage } from 'koishi-plugin-chatluna/utils/langchain'
import { parseRawModelName } from '../utils/model'
import { ConversationRecord } from './conversation_types'
import { Message } from '../types'
import type { PostHandler } from '../utils/types'
import { ActiveRequest, ChatEvents, RuntimeConversationEntry } from './types'
import { type UsageMetadata } from '@langchain/core/messages'

export interface ChatOptions {
    event?: ChatEvents
    stream?: boolean
    variables?: Record<string, unknown>
    postHandler?: PostHandler
    requestId?: string
    toolMask?: ToolMask
    callbacks?: Callbacks
    signal?: AbortSignal
}

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
        options: ChatOptions = {}
    ): Promise<Message> {
        return this.withConversationAndPlatformLock(
            conversation,
            async (config) =>
                this.internalChat(
                    config,
                    session,
                    conversation,
                    message,
                    options
                )
        )
    }

    private async internalChat(
        config: ClientConfig,
        session: Session,
        conversation: ConversationRecord,
        message: Message,
        options: ChatOptions
    ): Promise<Message> {
        const requestId = options.requestId ?? randomUUID()
        const platform = requirePlatform(conversation)

        const chatInterface = await this.ensureChatInterface(conversation)
        const abortController = new AbortController()
        const releaseSignal = linkAbortSignal(abortController, options.signal)
        const activeRequest = this.registerRequest(
            conversation.id,
            requestId,
            conversation.chatMode,
            platform,
            abortController,
            session
        )

        let lastActiveAt = Date.now()
        const touch = () => {
            lastActiveAt = Date.now()
        }
        const events = wrapEvents(options.event, touch)

        let releaseIdleTimer: () => void = () => {}
        if (config.timeout > 0) {
            releaseIdleTimer = this.service.ctx.setInterval(
                () => {
                    if (abortController.signal.aborted) return
                    if (Date.now() - lastActiveAt < config.timeout) return
                    abortController.abort(
                        new ChatLunaError(
                            ChatLunaErrorCode.API_REQUEST_TIMEOUT,
                            undefined,
                            true
                        )
                    )
                },
                Math.min(config.timeout, 30000)
            )
        }

        try {
            const humanMessage = buildHumanMessage(
                session,
                message,
                conversation
            )
            const stream = options.stream ?? false
            const variables = options.variables ?? {}
            const mask =
                options.toolMask ??
                (await this.platformService.resolveToolMask({
                    session,
                    conversation,
                    bindingKey: conversation.bindingKey
                }))

            const chainValues = await chatInterface.chat({
                message: humanMessage,
                events,
                stream,
                conversationId: conversation.id,
                requestId,
                session,
                variables,
                signal: abortController.signal,
                postHandler: options.postHandler,
                messageQueue: activeRequest.messageQueue,
                toolMask: mask,
                callbacks: await this.service.resolveCallbacks({
                    session,
                    conversation,
                    message,
                    event: events,
                    stream,
                    variables,
                    postHandler: options.postHandler,
                    requestId,
                    toolMask: mask,
                    callbacks: options.callbacks
                }),
                onAgentEvent: async (agentEvent) => {
                    touch()
                    if (agentEvent.type !== 'round-decision') return
                    activeRequest.lastDecision = agentEvent.canContinue
                    if (agentEvent.canContinue == null) return
                    flushRoundDecision(activeRequest, agentEvent.canContinue)
                }
            })

            return this.buildReply(chainValues.message as AIMessage)
        } finally {
            releaseIdleTimer()
            releaseSignal()
            this.completeRequest(conversation.id, requestId)
        }
    }

    private buildReply(aiMessage: AIMessage): Message {
        const reasoning = aiMessage.additional_kwargs?.reasoning_content as
            | string
            | undefined
        const reasoningTime = aiMessage.additional_kwargs?.reasoning_time as
            | number
            | undefined
        const usage = aiMessage.usage_metadata
        const showThought = this.service.currentConfig.showThoughtMessage
        const additionalReplyMessages: Message[] = []

        if (showThought && reasoning != null && reasoning.length > 0) {
            additionalReplyMessages.push({
                content:
                    reasoningTime != null
                        ? `Thought for ${reasoningTime / 1000} seconds: \n\n${reasoning}`
                        : `Thought: \n\n${reasoning}`
            })
        }

        if (showThought && usage != null && usage.total_tokens > 0) {
            additionalReplyMessages.push({
                content: formatUsageMetadataMessage(usage)
            })
        }

        return {
            content: aiMessage.content as string,
            additional_kwargs: aiMessage.additional_kwargs,
            additionalReplyMessages
        }
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
        callback: (config: ClientConfig) => Promise<T>
    ): Promise<T> {
        const requestId = randomUUID()
        const modelRequestId = randomUUID()
        const platform = requirePlatform(conversation)
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
                this.conversationQueue.wait(
                    conversation.id,
                    requestId,
                    0,
                    config.timeout
                ),
                this.modelQueue.wait(
                    platform,
                    modelRequestId,
                    config.concurrentMaxSize,
                    config.timeout
                )
            ])
            return await callback(config)
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
                    : buildRequestKey(session, conversationId),
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
            flushRoundDecision(active, false)
            this.activeByConversation.delete(conversationId)
        }
    }

    stopRequest(requestId: string) {
        const active = Array.from(this.activeByConversation.values()).find(
            (item) => item.requestId === requestId
        )
        if (active == null || active.abortController.signal.aborted) {
            return false
        }
        active.abortController.abort(
            new ChatLunaError(ChatLunaErrorCode.ABORTED, undefined, true)
        )
        return true
    }

    stopConversationRequest(conversationId: string) {
        const activeRequest = this.activeByConversation.get(conversationId)
        return activeRequest == null
            ? false
            : this.stopRequest(activeRequest.requestId)
    }

    getRequestId(session: Session, conversationId: string) {
        const active = this.activeByConversation.get(conversationId)
        if (active == null) return undefined
        if (active.requestKey !== buildRequestKey(session, conversationId)) {
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
                'chatluna/before-conversation-clear-history',
                { conversation, chatInterface }
            )
            await this.service.ctx.root.parallel(
                'chatluna/clear-chat-history',
                conversation.id,
                chatInterface
            )
            await chatInterface.clearChatHistory()
            this.interfaces.delete(conversation.id)
            await this.service.ctx.root.parallel(
                'chatluna/after-conversation-clear-history',
                { conversation, chatInterface }
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
            'chatluna/before-conversation-cache-clear',
            { conversation, chatInterface: cached?.chatInterface }
        )
        this.interfaces.delete(conversation.id)
        await this.service.ctx.root.parallel(
            'chatluna/after-conversation-cache-clear',
            { conversation }
        )
        return existed
    }

    async clearConversationInterface(conversation: ConversationRecord) {
        return this.withConversationLock(conversation.id, () =>
            this.clearConversationInterfaceLocked(conversation)
        )
    }

    dispose(platform?: string) {
        const abortActive = (active: ActiveRequest) => {
            flushRoundDecision(active, false)
            active.abortController.abort(
                new ChatLunaError(ChatLunaErrorCode.ABORTED, undefined, true)
            )
        }

        if (platform == null) {
            for (const active of this.activeByConversation.values()) {
                abortActive(active)
            }
            this.interfaces.clear()
            this.activeByConversation.clear()
            return
        }

        for (const active of Array.from(this.activeByConversation.values())) {
            if (active.platform !== platform) continue
            abortActive(active)
            this.activeByConversation.delete(active.conversationId)
            this.interfaces.delete(active.conversationId)
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

const EVENT_KEYS: readonly (keyof ChatEvents)[] = [
    'llm-new-token',
    'llm-queue-waiting',
    'llm-used-token-count',
    'llm-usage',
    'llm-call-tool',
    'llm-new-chunk'
]

function wrapEvents(source: ChatEvents | undefined, touch: () => void) {
    const out: Record<string, (...args: unknown[]) => Promise<void>> = {}
    for (const key of EVENT_KEYS) {
        const fn = source?.[key] as
            | ((...a: unknown[]) => Promise<void>)
            | undefined
        out[key] = async (...args: unknown[]) => {
            touch()
            await fn?.(...args)
        }
    }
    return out as ChatEvents
}

function linkAbortSignal(controller: AbortController, upstream?: AbortSignal) {
    if (upstream == null) return () => {}
    if (upstream.aborted) {
        controller.abort(upstream.reason)
        return () => {}
    }
    const onAbort = () => controller.abort(upstream.reason)
    upstream.addEventListener('abort', onAbort, { once: true })
    return () => upstream.removeEventListener('abort', onAbort)
}

function buildHumanMessage(
    session: Session,
    message: Message,
    conversation: ConversationRecord
) {
    const humanMessage = new HumanMessage({
        content: message.content,
        name: message.name,
        id: session.userId,
        additional_kwargs: {
            ...message.additional_kwargs,
            preset: conversation.preset
        }
    })
    markChatLunaUserMessage(humanMessage)
    return humanMessage
}

function buildRequestKey(session: Session, conversationId: string) {
    return JSON.stringify([
        session.userId,
        session.guildId ?? '',
        conversationId
    ])
}

function requirePlatform(conversation: ConversationRecord) {
    const [platform] = parseRawModelName(conversation.model)
    if (platform == null) {
        throw new ChatLunaError(
            ChatLunaErrorCode.UNKNOWN_ERROR,
            new Error(`Invalid conversation model: ${conversation.model}`)
        )
    }
    return platform
}

function formatTokenDetail(
    detail: Record<string, number | undefined> | undefined,
    fields: readonly { key: string; positiveOnly?: boolean }[]
) {
    if (detail == null) return []
    const parts: string[] = []
    for (const { key, positiveOnly } of fields) {
        const value = detail[key]
        if (value == null) continue
        if (positiveOnly && !(value > 0)) continue
        parts.push(`${key}=${value}`)
    }
    return parts
}

function formatUsageMetadataMessage(usage: UsageMetadata) {
    const input = formatTokenDetail(usage.input_token_details, [
        { key: 'audio', positiveOnly: true },
        { key: 'image', positiveOnly: true },
        { key: 'cache_read' },
        { key: 'cache_creation' }
    ])
    const output = formatTokenDetail(usage.output_token_details, [
        { key: 'audio', positiveOnly: true },
        { key: 'image', positiveOnly: true },
        { key: 'reasoning' }
    ])

    const lines = [
        'Token usage:',
        `- input: ${usage.input_tokens}`,
        `- output: ${usage.output_tokens}`,
        `- total: ${usage.total_tokens}`
    ]
    if (input.length > 0) lines.push(`- input details: ${input.join(', ')}`)
    if (output.length > 0) lines.push(`- output details: ${output.join(', ')}`)
    return lines.join('\n')
}

function flushRoundDecision(active: ActiveRequest, canContinue: boolean) {
    for (const resolve of active.roundDecisionResolvers) {
        resolve(canContinue)
    }
    active.roundDecisionResolvers = []
}

export type {
    ChatEvents,
    RuntimeConversationEntry,
    ActiveRequest
} from './types'
