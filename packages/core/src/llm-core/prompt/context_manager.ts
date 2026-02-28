import { BaseMessage, HumanMessage } from '@langchain/core/messages'
import { Document } from '@langchain/core/documents'
import { ChainValues } from '@langchain/core/utils/types'
import { AuthorsNote, PresetTemplate, RoleBook } from './type'
import type {
    ChatLunaPromptRenderService,
    RenderConfigurable
} from '../../services/chat'
import { Context } from 'koishi'

// ---------------------------------------------------------------------------
// Pipeline stages – ordered from first to last
// ---------------------------------------------------------------------------

/**
 * Built-in pipeline stages executed in order during prompt assembly.
 *
 * Custom string stages are also allowed; they run after all built-in stages
 * unless an explicit order is given.
 */
export type PromptPipelineStage =
    | 'system_prompts'
    | 'chat_history'
    | 'long_history'
    | 'injections'
    | 'input'
    | 'scratchpad'
    | 'after_scratchpad'
    | string

/** Canonical ordering for built-in stages. */
export const STAGE_ORDER: Record<string, number> = {
    system_prompts: 0,
    chat_history: 100,
    long_history: 200,
    injections: 300,
    input: 400,
    scratchpad: 500,
    after_scratchpad: 600
}

// ---------------------------------------------------------------------------
// Anchor-based injection – messages anchored between two message IDs
// ---------------------------------------------------------------------------

/**
 * An injection anchored between two messages in the conversation context,
 * identified by `BaseMessage.id`.
 *
 * At collection time every message in the assembled result that lacks an
 * `.id` is stamped with a generated one.  An injection whose
 * `afterMessageId` is no longer found in the current result is immediately
 * pruned from persistent storage — it is considered permanently stale.
 *
 * If only `afterMessageId` is given, the content is inserted after that
 * message.  If only `beforeMessageId` is given, it is inserted before it.
 * If neither is given, the content is appended at the end of the stage.
 */
export interface AnchoredInjection {
    id: string
    name: string
    value: unknown

    /** Insert after the message whose `BaseMessage.id` matches. */
    afterMessageId?: string
    /** Insert before the message whose `BaseMessage.id` matches. */
    beforeMessageId?: string

    /** Pipeline stage where this injection should be applied. */
    stage: PromptPipelineStage

    /** Lower priority = earlier execution within the same stage. */
    priority: number
    createdAt: number

    /**
     * If true the injection is removed after a single collection cycle.
     * Otherwise it persists until its `afterMessageId` anchor disappears
     * from the assembled result or it is explicitly removed.
     */
    once?: boolean
}

// ---------------------------------------------------------------------------
// Runtime context that flows through the entire pipeline
// ---------------------------------------------------------------------------

export interface PromptContextRuntime {
    /** The final message array being assembled (mutated in place). */
    result: BaseMessage[]

    /** Template / chat variables. */
    variables: ChainValues

    /** Per-request configurable (session, conversationId, …). */
    configurable?: RenderConfigurable

    /** Running token count consumed so far. */
    usedTokens: number

    /** Hard ceiling for the whole prompt. */
    sendTokenLimit: number

    /** Counts tokens for an arbitrary string. */
    tokenCounter: (text: string) => Promise<number>

    /** Render service for template expansion. */
    promptRenderService: ChatLunaPromptRenderService

    /** The preset in use for this request. */
    preset: PresetTemplate

    // -- Inputs provided by the caller (ChatLunaChatPrompt.formatMessages) --

    /** The current user input message. */
    input?: BaseMessage

    /** Raw chat history before truncation. */
    chatHistory?: BaseMessage[]

    /** Document collections (long_memory, knowledge, other docs). */
    documents?: Document[][]

    /** Agent scratchpad messages, if any. */
    agentScratchpad?: BaseMessage[] | BaseMessage

    /** Instructions (e.g. partial variable). */
    instructions?: string

    /** Message inserted after user message in agent mode. */
    afterUserMessage?: BaseMessage
}

// ---------------------------------------------------------------------------
// Middleware types
// ---------------------------------------------------------------------------

export interface PromptContextMiddlewareContext {
    injection: AnchoredInjection
    runtime: PromptContextRuntime
    handled: boolean
    markHandled: () => void

    /** Helper to convert raw values to messages and push onto result. */
    appendMessages: (
        input: BaseMessage | BaseMessage[] | string | string[]
    ) => BaseMessage[]

    /**
     * Insert messages at the anchor position described by the injection.
     * Returns the index where the first message was inserted.
     */
    insertAtAnchor: (messages: BaseMessage | BaseMessage[]) => number
}

export type PromptContextMiddleware = (
    context: PromptContextMiddlewareContext,
    next: () => Promise<void>
) => Promise<void>

interface PromptContextMiddlewareWithPriority {
    middleware: PromptContextMiddleware
    priority: number
}

// ---------------------------------------------------------------------------
// Pipeline middleware — one per stage
// ---------------------------------------------------------------------------

/**
 * A pipeline middleware handles an entire stage of prompt assembly.
 *
 * Unlike injection middlewares (which handle a single `AnchoredInjection`),
 * pipeline middlewares are responsible for a whole stage and receive the full
 * runtime context to produce their output.
 */
export type PromptPipelineMiddleware = (
    runtime: PromptContextRuntime,
    next: () => Promise<void>
) => Promise<void>

export interface PipelineMiddlewareEntry {
    stage: PromptPipelineStage
    middleware: PromptPipelineMiddleware
    priority: number
}

// ---------------------------------------------------------------------------
// Inject options
// ---------------------------------------------------------------------------

export interface InjectPromptContextOptions {
    name: string
    value: unknown
    conversationId?: string
    stage?: PromptPipelineStage

    /**
     * Anchor: insert after the message whose `BaseMessage.id` equals this
     * value.  The injection is considered stale and will be pruned the
     * moment this message is no longer present in the assembled result.
     */
    afterMessageId?: string

    /**
     * Anchor: insert before the message whose `BaseMessage.id` equals this
     * value.
     */
    beforeMessageId?: string

    /** If true the injection is consumed after one collection cycle. */
    once?: boolean

    priority?: number
}

// ---------------------------------------------------------------------------
// Collect options (passed by ChatLunaChatPrompt.formatMessages)
// ---------------------------------------------------------------------------

export interface CollectPromptContextOptions {
    variables?: ChainValues
    configurable?: RenderConfigurable
    afterUserMessage?: BaseMessage
    /**
     * The messages assembled so far in the current pipeline run (i.e.
     * `runtime.result` at the moment the injections stage fires).
     *
     * `collectInjections` will:
     * 1. Stamp a generated `id` on any message that has none.
     * 2. Build the live id set from these messages.
     * 3. Prune persistent injections whose `afterMessageId` is no longer
     *    present — they are dropped from storage immediately.
     */
    currentMessages: BaseMessage[]
}

// Backward compat re-exports kept for old code:
export type PromptInjectionStage = PromptPipelineStage
export type PromptContextInjection = AnchoredInjection
export interface PromptContextInjectionCollection {
    beforeScratchpad: AnchoredInjection[]
    afterScratchpad: AnchoredInjection[]
}

// Keep old helper types for backward compatibility
export interface PromptContextRuntimeHelpers {
    formatLoreBooks?: (
        loreBooks: RoleBook[],
        usedTokens: number,
        result: BaseMessage[],
        variables: ChainValues
    ) => Promise<number>
    counterAuthorsNote?: (
        authorsNote: AuthorsNote,
        variables?: ChainValues,
        configurable?: RenderConfigurable
    ) => Promise<[string, number]>
    formatAuthorsNote?: (
        authorsNote: AuthorsNote,
        result: BaseMessage[],
        formatResult: [string, number]
    ) => void | number
}

// ==========================================================================
// ChatLunaContextManagerService
// ==========================================================================

export class ChatLunaContextManagerService {
    // -- injection middlewares (per-name, handles a single AnchoredInjection) --
    private _middlewares = new Map<
        string,
        PromptContextMiddlewareWithPriority[]
    >()

    // -- pipeline middlewares (per-stage, handles the whole stage) --
    private _pipelineMiddlewares: PipelineMiddlewareEntry[] = []

    // -- storage --
    private _conversationPersistent = new Map<string, AnchoredInjection[]>()
    private _conversationQueue = new Map<string, AnchoredInjection[]>()

    private _skillProviders = new Set<unknown>()

    constructor(ctx: Context) {
        ctx.on('chatluna/clear-chat-history', async (conversationId) => {
            this.clearConversation(conversationId)
        })
    }

    // -----------------------------------------------------------------------
    // Pipeline middleware registration
    // -----------------------------------------------------------------------

    /**
     * Register a pipeline middleware for a given stage.
     *
     * Pipeline middlewares execute in `(stage-order, priority)` order.
     * Lower priority = earlier within the same stage.
     *
     * Returns a disposer function.
     */
    pipeline(
        stage: PromptPipelineStage,
        middleware: PromptPipelineMiddleware,
        priority = 0
    ): () => void {
        const entry: PipelineMiddlewareEntry = { stage, middleware, priority }
        this._pipelineMiddlewares.push(entry)
        this._pipelineMiddlewares.sort((a, b) => {
            const sa = STAGE_ORDER[a.stage] ?? 999
            const sb = STAGE_ORDER[b.stage] ?? 999
            if (sa !== sb) return sa - sb
            return a.priority - b.priority
        })

        return () => {
            const idx = this._pipelineMiddlewares.indexOf(entry)
            if (idx !== -1) this._pipelineMiddlewares.splice(idx, 1)
        }
    }

    /**
     * Execute the full pipeline.  Each registered pipeline middleware is
     * called in order.  The `next()` function advances to the next
     * middleware.
     */
    async runPipeline(runtime: PromptContextRuntime): Promise<void> {
        const entries = [...this._pipelineMiddlewares]
        let index = -1

        const dispatch = async (step: number): Promise<void> => {
            if (step <= index) {
                throw new Error('Pipeline middleware called next() twice')
            }
            index = step
            const current = entries[step]
            if (!current) return
            await current.middleware(runtime, () => dispatch(step + 1))
        }

        await dispatch(0)
    }

    // -----------------------------------------------------------------------
    // Injection middleware registration (per-name, backward-compatible)
    // -----------------------------------------------------------------------

    intercept(
        name: string,
        middleware: PromptContextMiddleware,
        priority = 0
    ): () => void {
        const wrappers = this._middlewares.get(name) ?? []
        const wrapper = { middleware, priority }

        const insertAt = wrappers.findIndex((item) => item.priority > priority)
        if (insertAt === -1) {
            wrappers.push(wrapper)
        } else {
            wrappers.splice(insertAt, 0, wrapper)
        }

        this._middlewares.set(name, wrappers)

        return () => {
            const current = this._middlewares.get(name)
            if (!current) return
            const idx = current.findIndex(
                (item) => item.middleware === middleware
            )
            if (idx === -1) return
            if (current.length === 1) {
                this._middlewares.delete(name)
            } else {
                current.splice(idx, 1)
            }
        }
    }

    replace(name: string, middleware: PromptContextMiddleware): () => void {
        this._middlewares.set(name, [{ middleware, priority: 0 }])
        return () => this._middlewares.delete(name)
    }

    has(name: string): boolean {
        const wrappers = this._middlewares.get(name)
        return wrappers != null && wrappers.length > 0
    }

    // -----------------------------------------------------------------------
    // Injection storage
    // -----------------------------------------------------------------------

    /**
     * Inject content into a conversation's context.
     *
     * Content can be anchored between two messages (by message ID).  As long
     * as both anchor messages exist in the assembled prompt, the injection
     * will be placed between them.
     *
     * If `once` is true the injection is consumed after one collection.
     * Otherwise it persists until the anchor messages are gone or it is
     * cleared.
     */
    inject(options: InjectPromptContextOptions): void {
        const injection = this._createInjection(options)

        if (!options.conversationId) return

        const store = options.once
            ? this._conversationQueue
            : this._conversationPersistent

        this._addToStore(store, options.conversationId, injection)
    }

    /**
     * Remove a specific persistent injection by id.
     */
    removeInjection(conversationId: string, injectionId: string): boolean {
        const list = this._conversationPersistent.get(conversationId)
        if (!list) return false
        const idx = list.findIndex((item) => item.id === injectionId)
        if (idx === -1) return false
        list.splice(idx, 1)
        return true
    }

    // -----------------------------------------------------------------------
    // Collecting injections for the current prompt render
    // -----------------------------------------------------------------------

    collectInjections({
        variables,
        configurable,
        afterUserMessage,
        currentMessages
    }: CollectPromptContextOptions): PromptContextInjectionCollection {
        const conversationId = configurable?.conversationId

        // Step 1: stamp ids on any message that lacks one.
        for (const msg of currentMessages) {
            if (!msg.id) {
                msg.id = this._createId()
            }
        }

        // Step 2: build the live id set from the already-assembled result.
        const liveIds = new Set(
            currentMessages.map((m) => m.id).filter(Boolean)
        )

        const collected: AnchoredInjection[] = []

        if (conversationId) {
            const persistent =
                this._conversationPersistent.get(conversationId) ?? []

            // Step 3: prune persistent injections whose anchor references
            // are no longer present in the live result.
            const alive = persistent.filter((inj) => {
                if (inj.beforeMessageId && !liveIds.has(inj.beforeMessageId)) {
                    return false
                }
                if (!inj.afterMessageId) return true
                return liveIds.has(inj.afterMessageId)
            })

            if (alive.length !== persistent.length) {
                this._conversationPersistent.set(conversationId, alive)
            }

            collected.push(...alive)

            const queued = this._conversationQueue.get(conversationId) ?? []
            if (queued.length > 0) {
                this._conversationQueue.delete(conversationId)
            }
            collected.push(...queued)
        }

        // Inline injections from variables (backward compat)
        if (
            Array.isArray(variables?.['lore_books']) &&
            variables['lore_books'].length > 0
        ) {
            collected.push(
                this._createInjection({
                    name: 'lore_books',
                    value: variables['lore_books'],
                    stage: 'injections'
                })
            )
        }

        if (variables?.['authors_note']) {
            collected.push(
                this._createInjection({
                    name: 'authors_note',
                    value: variables['authors_note'],
                    stage: 'injections'
                })
            )
        }

        if (afterUserMessage) {
            collected.push(
                this._createInjection({
                    name: 'after_user_message',
                    value: afterUserMessage,
                    stage: 'after_scratchpad'
                })
            )
        }

        collected.sort((a, b) => {
            if (a.priority !== b.priority) return a.priority - b.priority
            return a.createdAt - b.createdAt
        })

        return {
            beforeScratchpad: collected.filter(
                (item) =>
                    item.stage !== 'after_scratchpad' &&
                    item.stage !== 'scratchpad'
            ),
            afterScratchpad: collected.filter(
                (item) => item.stage === 'after_scratchpad'
            )
        }
    }

    // -----------------------------------------------------------------------
    // Applying injections (runs per-name middleware chains)
    // -----------------------------------------------------------------------

    async applyInjections(
        injections: AnchoredInjection[],
        runtime: PromptContextRuntime
    ): Promise<PromptContextRuntime> {
        for (const injection of injections) {
            await this._applySingleInjection(injection, runtime)
        }
        return runtime
    }

    // -----------------------------------------------------------------------
    // Anchor helpers – find position by message ID
    // -----------------------------------------------------------------------

    /**
     * Find the index in `messages` where content anchored by
     * `afterMessageId` / `beforeMessageId` should be inserted.
     *
     * Matches against `BaseMessage.id`.  Returns the splice index.
     */
    static findAnchorIndex(
        messages: BaseMessage[],
        afterMessageId?: string,
        beforeMessageId?: string
    ): number {
        if (afterMessageId) {
            const idx = messages.findIndex((m) => m.id === afterMessageId)
            if (idx !== -1) return idx + 1
        }

        if (beforeMessageId) {
            const idx = messages.findIndex((m) => m.id === beforeMessageId)
            if (idx !== -1) return idx
        }

        // Fallback: append at the end
        return messages.length
    }

    /**
     * Return true when all specified anchor messages are present in
     * `messages` (matched by `BaseMessage.id`).
     */
    static anchorsExist(
        messages: BaseMessage[],
        afterMessageId?: string,
        beforeMessageId?: string
    ): boolean {
        if (!afterMessageId && !beforeMessageId) return true

        const ids = new Set(messages.map((m) => m.id).filter(Boolean))

        if (afterMessageId && !ids.has(afterMessageId)) return false
        if (beforeMessageId && !ids.has(beforeMessageId)) return false

        return true
    }

    // -----------------------------------------------------------------------
    // Cleanup
    // -----------------------------------------------------------------------

    clearConversation(conversationId: string): void {
        this._conversationQueue.delete(conversationId)
        this._conversationPersistent.delete(conversationId)
    }

    clearAll(): void {
        this._conversationQueue.clear()
        this._conversationPersistent.clear()
    }

    registerSkillProvider(provider: unknown): () => void {
        this._skillProviders.add(provider)
        return () => {
            this._skillProviders.delete(provider)
        }
    }

    // -----------------------------------------------------------------------
    // Private helpers
    // -----------------------------------------------------------------------

    private _createInjection(
        options: InjectPromptContextOptions
    ): AnchoredInjection {
        return {
            id: this._createId(),
            name: options.name,
            value: options.value,
            afterMessageId: options.afterMessageId,
            beforeMessageId: options.beforeMessageId,
            stage: options.stage ?? this._resolveDefaultStage(options.name),
            createdAt: Date.now(),
            priority: options.priority ?? 0,
            once: options.once
        }
    }

    private _resolveDefaultStage(name: string): PromptPipelineStage {
        if (name === 'after_user_message' || name === 'tool_observation') {
            return 'after_scratchpad'
        }
        return 'injections'
    }

    private _createId(): string {
        return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
    }

    private _addToStore(
        store: Map<string, AnchoredInjection[]>,
        key: string,
        injection: AnchoredInjection
    ): void {
        const current = store.get(key)
        if (!current) {
            store.set(key, [injection])
            return
        }
        current.push(injection)
    }

    private async _applySingleInjection(
        injection: AnchoredInjection,
        runtime: PromptContextRuntime
    ): Promise<void> {
        const wrappers = [
            ...(this._middlewares.get('*') ?? []),
            ...(this._middlewares.get(injection.name) ?? [])
        ]

        const context: PromptContextMiddlewareContext = {
            injection,
            runtime,
            handled: false,
            markHandled: () => {
                context.handled = true
            },
            appendMessages: (
                input: BaseMessage | BaseMessage[] | string | string[]
            ) => {
                const messages = toMessages(input)
                if (messages.length > 0) {
                    runtime.result.push(...messages)
                }
                return messages
            },
            insertAtAnchor: (input: BaseMessage | BaseMessage[]) => {
                const messages = Array.isArray(input) ? input : [input]
                if (messages.length === 0) return runtime.result.length

                const idx = ChatLunaContextManagerService.findAnchorIndex(
                    runtime.result,
                    injection.afterMessageId,
                    injection.beforeMessageId
                )
                runtime.result.splice(idx, 0, ...messages)
                return idx
            }
        }

        if (wrappers.length > 0) {
            let index = -1
            const dispatch = async (step: number): Promise<void> => {
                if (step <= index) {
                    throw new Error(
                        'Prompt context middleware called next() twice'
                    )
                }
                index = step
                const current = wrappers[step]
                if (!current) return
                await current.middleware(context, () => dispatch(step + 1))
            }
            await dispatch(0)
        }

        if (!context.handled) {
            const messages = toMessages(injection.value)
            if (messages.length > 0) {
                if (injection.afterMessageId || injection.beforeMessageId) {
                    context.insertAtAnchor(messages)
                } else {
                    runtime.result.push(...messages)
                }
            }
        }
    }
}

// ---------------------------------------------------------------------------
// Utility
// ---------------------------------------------------------------------------

export function toMessages(input: unknown): BaseMessage[] {
    if (input == null) return []

    if (Array.isArray(input)) {
        return input.flatMap((item) => toMessages(item))
    }

    if (input instanceof BaseMessage) return [input]

    if (typeof input === 'string') {
        if (input.trim().length < 1) return []
        return [new HumanMessage(input)]
    }

    return []
}
