import { EventEmitter } from 'events'
import { Context, h, Logger, Session } from 'koishi'
import {
    ChatLunaError,
    ChatLunaErrorCode,
    setErrorFormatTemplate
} from 'koishi-plugin-chatluna/utils/error'
import { createLogger } from 'koishi-plugin-chatluna/utils/logger'
import { Config } from '../config'
import { lifecycleNames } from '../middlewares/system/lifecycle'

let logger: Logger

export class ChatChain {
    public readonly _graph: ChatChainDependencyGraph
    private readonly _senders: ChatChainSender[]
    private isSetErrorMessage = false

    constructor(
        private readonly ctx: Context,
        private readonly config: Config
    ) {
        logger = createLogger(ctx)
        this._graph = new ChatChainDependencyGraph()
        this._senders = []

        const defaultChatChainSender = new DefaultChatChainSender(config)

        this._senders.push((session, messages) =>
            defaultChatChainSender.send(session, messages)
        )
    }

    private _createRecallThinkingMessage(
        context: ChainMiddlewareContext
    ): () => Promise<void> {
        return async () => {
            if (!context.options?.thinkingTimeoutObject) return

            const timeoutObj = context.options.thinkingTimeoutObject

            clearTimeout(timeoutObj.timeout!)

            timeoutObj.autoRecallTimeout &&
                clearTimeout(timeoutObj.autoRecallTimeout)

            timeoutObj.recallFunc && (await timeoutObj.recallFunc())

            timeoutObj.timeout = null
            context.options.thinkingTimeoutObject = undefined
        }
    }

    async receiveMessage(session: Session, ctx?: Context) {
        const context: ChainMiddlewareContext = {
            config: this.config,
            message: session.content,
            ctx: ctx ?? this.ctx,
            session,
            options: {},
            send: (message) => this.sendMessage(session, message),
            recallThinkingMessage: this._createRecallThinkingMessage(
                {} as ChainMiddlewareContext
            )
        }

        context.recallThinkingMessage =
            this._createRecallThinkingMessage(context)

        const result = await this._runMiddleware(session, context)

        await context.recallThinkingMessage()

        return result
    }

    async receiveCommand(
        session: Session,
        command: string,
        options: ChainMiddlewareContextOptions = {},
        ctx: Context = this.ctx
    ) {
        const context: ChainMiddlewareContext = {
            config: this.config,
            message: options?.message ?? session.content,
            ctx,
            session,
            command,
            send: (message) => this.sendMessage(session, message),
            recallThinkingMessage: this._createRecallThinkingMessage(
                {} as ChainMiddlewareContext
            ),
            options
        }

        context.recallThinkingMessage =
            this._createRecallThinkingMessage(context)

        const result = await this._runMiddleware(session, context)

        await context.recallThinkingMessage()

        return result
    }

    middleware<T extends keyof ChainMiddlewareName>(
        name: T,
        middleware: ChainMiddlewareFunction,
        ctx: Context = this.ctx
    ): ChainMiddleware {
        const result = new ChainMiddleware(name, middleware, this._graph)

        this._graph.addNode(result)

        const dispose = () => this._graph.removeNode(name)

        ctx.effect(() => dispose)

        return result
    }

    sender(sender: ChatChainSender) {
        this._senders.push(sender)
    }

    private async _runMiddleware(
        session: Session,
        context: ChainMiddlewareContext
    ) {
        if (!this.isSetErrorMessage) {
            setErrorFormatTemplate(session.text('chatluna.error_message'))
            this.isSetErrorMessage = true
        }

        const originMessage = context.message
        const runLevels = this._graph.build()

        if (runLevels.length === 0) {
            return false
        }
        let isOutputLog = false

        for (const level of runLevels) {
            const results = await this._executeLevel(level, session, context)

            for (const result of results) {
                if (result.status === 'stop') {
                    await this._handleStopStatus(
                        session,
                        context,
                        originMessage,
                        isOutputLog
                    )
                    return false
                }

                if (result.status === 'error') {
                    await this._handleMiddlewareError(
                        session,
                        result.middlewareName!,
                        result.error!
                    )
                    return false
                }

                if (
                    result.output instanceof Array ||
                    typeof result.output === 'string'
                ) {
                    context.message = result.output
                }

                if (result.shouldLog) {
                    isOutputLog = true
                }
            }
        }

        if (isOutputLog) {
            logger.debug('-'.repeat(40) + '\n')
        }

        if (context.message != null && context.message !== originMessage) {
            await this.sendMessage(session, context.message)
        }

        return true
    }

    private async _executeLevel(
        middlewares: ChainMiddleware[],
        session: Session,
        context: ChainMiddlewareContext
    ): Promise<MiddlewareResult[]> {
        const abortController = new AbortController()
        const results: MiddlewareResult[] = []
        let hasStopRequest = false
        let hasError = false

        const promises = middlewares.map(async (middleware, index) => {
            try {
                if (abortController.signal.aborted) {
                    return {
                        status: 'success' as const,
                        output: ChainMiddlewareRunStatus.SKIPPED,
                        middlewareName: middleware.name,
                        shouldLog: false
                    }
                }

                const result = await this._executeMiddleware(
                    middleware,
                    session,
                    context,
                    abortController.signal
                )

                if (result.status === 'stop' && !hasStopRequest) {
                    hasStopRequest = true
                    abortController.abort()
                }

                if (result.status === 'error' && !hasError) {
                    hasError = true
                    abortController.abort()
                }

                results[index] = result
                return result
            } catch (error) {
                const errorResult: MiddlewareResult = {
                    status: 'error',
                    error: error as Error,
                    middlewareName: middleware.name,
                    shouldLog: false
                }

                if (!hasError) {
                    hasError = true
                    abortController.abort()
                }

                results[index] = errorResult
                return errorResult
            }
        })

        await Promise.all(promises)

        return results.filter((result) => result !== undefined)
    }

    private async _executeMiddleware(
        middleware: ChainMiddleware,
        session: Session,
        context: ChainMiddlewareContext,
        abortSignal?: AbortSignal
    ): Promise<MiddlewareResult> {
        const startTime = Date.now()

        try {
            if (abortSignal?.aborted) {
                return {
                    status: 'success',
                    output: ChainMiddlewareRunStatus.SKIPPED,
                    middlewareName: middleware.name,
                    shouldLog: false
                }
            }

            const result = await middleware.run(session, context)
            const executionTime = Date.now() - startTime

            const shouldLogTime =
                !middleware.name.startsWith('lifecycle-') &&
                result !== ChainMiddlewareRunStatus.SKIPPED &&
                middleware.name !== 'allow_reply' &&
                executionTime > 100

            if (shouldLogTime) {
                logger.debug(
                    `middleware %c executed in %d ms`,
                    middleware.name,
                    executionTime
                )
            }

            if (result === ChainMiddlewareRunStatus.STOP) {
                return {
                    status: 'stop',
                    middlewareName: middleware.name,
                    shouldLog: shouldLogTime
                }
            }

            return {
                status: 'success',
                output: result,
                middlewareName: middleware.name,
                shouldLog: shouldLogTime
            }
        } catch (error) {
            return {
                status: 'error',
                error,
                middlewareName: middleware.name,
                shouldLog: false
            }
        }
    }

    private async sendMessage(
        session: Session,
        message: h[] | h[][] | h | string
    ) {
        const messages: (h[] | h | string)[] =
            message instanceof Array ? message : [message]

        for (const sender of this._senders) {
            await sender(session, messages)
        }
    }

    private async _handleStopStatus(
        session: Session,
        context: ChainMiddlewareContext,
        originMessage: string | h[] | h[][],
        isOutputLog: boolean
    ) {
        if (context.message != null && context.message !== originMessage) {
            await this.sendMessage(session, context.message)
        }

        if (isOutputLog) {
            logger.debug('-'.repeat(40) + '\n')
        }
    }

    private async _handleMiddlewareError(
        session: Session,
        middlewareName: string,
        error: Error
    ) {
        if (error instanceof ChatLunaError) {
            const message =
                error.errorCode === ChatLunaErrorCode.ABORTED
                    ? session.text('chatluna.aborted')
                    : error.message
            await this.sendMessage(session, message)
            return
        }

        logger.error(`chat-chain: ${middlewareName} error ${error}`)
        logger.error(error)
        error.cause && logger.error(error.cause)
        logger.debug('-'.repeat(40) + '\n')

        await this.sendMessage(
            session,
            session.text('chatluna.middleware_error', [
                middlewareName,
                error.message
            ])
        )
    }
}

interface MiddlewareResult {
    status: 'success' | 'stop' | 'error'
    output?: ChainMiddlewareRunStatus | h[] | h | h[][] | string | null
    error?: Error
    middlewareName?: string
    shouldLog?: boolean
}

class ChatChainDependencyGraph {
    private readonly _tasks = new Map<string, ChainDependencyGraphNode>()
    private readonly _dependencies = new Map<string, Set<string>>()
    private readonly _eventEmitter = new EventEmitter()
    private readonly _listeners = new Map<
        string,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        Set<(...args: any[]) => void>
    >()

    private _cachedOrder: ChainMiddleware[][] | null = null

    constructor() {
        this._eventEmitter.on('build_node', () => {
            for (const [, listeners] of this._listeners) {
                for (const listener of listeners) {
                    listener()
                }
                listeners.clear()
            }
        })
    }

    public addNode(middleware: ChainMiddleware): void {
        this._tasks.set(middleware.name, {
            name: middleware.name,
            middleware
        })
        this._cachedOrder = null
    }

    removeNode(name: string): void {
        this._tasks.delete(name)
        this._dependencies.delete(name)
        for (const deps of this._dependencies.values()) {
            deps.delete(name)
        }
        this._cachedOrder = null
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    once(name: string, listener: (...args: any[]) => void) {
        const listeners = this._listeners.get(name) ?? new Set()
        listeners.add(listener)
        this._listeners.set(name, listeners)
    }

    before(
        taskA: ChainMiddleware | string,
        taskB: ChainMiddleware | string
    ): void {
        if (taskA instanceof ChainMiddleware) {
            taskA = taskA.name
        }
        if (taskB instanceof ChainMiddleware) {
            taskB = taskB.name
        }
        if (taskA && taskB) {
            const dependencies = this._dependencies.get(taskA) ?? new Set()
            dependencies.add(taskB)
            this._dependencies.set(taskA, dependencies)
        } else {
            throw new Error('Invalid tasks')
        }
    }

    after(
        taskA: ChainMiddleware | string,
        taskB: ChainMiddleware | string
    ): void {
        if (taskA instanceof ChainMiddleware) {
            taskA = taskA.name
        }
        if (taskB instanceof ChainMiddleware) {
            taskB = taskB.name
        }
        if (taskA && taskB) {
            const dependencies = this._dependencies.get(taskB) ?? new Set()
            dependencies.add(taskA)
            this._dependencies.set(taskB, dependencies)
        } else {
            throw new Error('Invalid tasks')
        }
    }

    getDependencies(task: string) {
        return this._dependencies.get(task)
    }

    getDependents(task: string): string[] {
        const dependents: string[] = []
        for (const [key, value] of this._dependencies.entries()) {
            if ([...value].includes(task)) {
                dependents.push(key)
            }
        }
        return dependents
    }

    build(): ChainMiddleware[][] {
        if (this._cachedOrder) {
            return this._cachedOrder
        }

        this._eventEmitter.emit('build_node')
        const indegree = new Map<string, number>()
        const tempGraph = new Map<string, Set<string>>()

        for (const taskName of this._tasks.keys()) {
            indegree.set(taskName, 0)
            tempGraph.set(taskName, new Set())
        }

        for (const [from, deps] of this._dependencies.entries()) {
            const depsSet = tempGraph.get(from) || new Set()
            for (const to of deps) {
                depsSet.add(to)
                indegree.set(to, (indegree.get(to) || 0) + 1)
            }
            tempGraph.set(from, depsSet)
        }

        const levels: ChainMiddleware[][] = []
        const visited = new Set<string>()
        let currentLevel: string[] = []

        for (const [task, degree] of indegree.entries()) {
            if (degree === 0) {
                currentLevel.push(task)
            }
        }

        while (currentLevel.length > 0) {
            const levelMiddlewares: ChainMiddleware[] = []
            const nextLevel: string[] = []

            for (const current of currentLevel) {
                if (visited.has(current)) continue
                visited.add(current)

                const node = this._tasks.get(current)
                if (node?.middleware) {
                    levelMiddlewares.push(node.middleware)
                }

                const successors = tempGraph.get(current) || new Set()
                for (const next of successors) {
                    const newDegree = indegree.get(next)! - 1
                    indegree.set(next, newDegree)
                    if (newDegree === 0) {
                        nextLevel.push(next)
                    }
                }
            }

            if (levelMiddlewares.length > 0) {
                levels.push(levelMiddlewares)
            }
            currentLevel = nextLevel
        }

        for (const [node, degree] of indegree.entries()) {
            if (degree > 0) {
                const cycles = this._findAllCycles()
                const relevantCycle = cycles.find((cycle) =>
                    cycle.includes(node)
                )
                throw new Error(
                    `Circular dependency detected involving nodes: ${relevantCycle?.join(' -> ') || node}`
                )
            }
        }

        if (visited.size !== this._tasks.size) {
            throw new Error(
                'Some nodes are unreachable in the dependency graph'
            )
        }

        this._cachedOrder = levels
        return levels
    }

    private _canRunInParallel(a: ChainMiddleware, b: ChainMiddleware): boolean {
        const aDeps = this._dependencies.get(a.name) || new Set()
        const bDeps = this._dependencies.get(b.name) || new Set()

        return (
            !aDeps.has(b.name) &&
            !bDeps.has(a.name) &&
            !this._hasTransitiveDependency(a.name, b.name) &&
            !this._hasTransitiveDependency(b.name, a.name)
        )
    }

    private _hasTransitiveDependency(
        from: string,
        to: string,
        visited = new Set<string>()
    ): boolean {
        if (visited.has(from)) return false
        visited.add(from)

        const deps = this._dependencies.get(from) || new Set()
        if (deps.has(to)) return true

        for (const dep of deps) {
            if (this._hasTransitiveDependency(dep, to, visited)) {
                return true
            }
        }

        return false
    }

    private _findAllCycles(): string[][] {
        const visited = new Set<string>()
        const recursionStack = new Set<string>()
        const cycles: string[][] = []

        const dfs = (node: string, path: string[]): void => {
            if (recursionStack.has(node)) {
                const cycleStart = path.indexOf(node)
                if (cycleStart !== -1) {
                    const cycle = path.slice(cycleStart).concat([node])
                    cycles.push(cycle)
                }
                return
            }

            if (visited.has(node)) {
                return
            }

            visited.add(node)
            recursionStack.add(node)
            path.push(node)

            const deps = this._dependencies.get(node) || new Set()
            for (const dep of deps) {
                dfs(dep, [...path])
            }

            recursionStack.delete(node)
        }

        for (const node of this._tasks.keys()) {
            if (!visited.has(node)) {
                dfs(node, [])
            }
        }

        return cycles
    }
}

interface ChainDependencyGraphNode {
    middleware?: ChainMiddleware
    name: string
}

export class ChainMiddleware {
    constructor(
        readonly name: string,
        private readonly execute: ChainMiddlewareFunction,
        private readonly graph: ChatChainDependencyGraph
    ) {}

    before<T extends keyof ChainMiddlewareName>(name: T) {
        this.graph.before(this.name, name)

        if (this.name.startsWith('lifecycle-')) {
            return this
        }

        const lifecycleName = lifecycleNames

        if (lifecycleName.includes(name)) {
            const lastLifecycleName =
                lifecycleName[lifecycleName.indexOf(name) - 1]

            if (lastLifecycleName) {
                this.graph.after(this.name, lastLifecycleName)
            }

            return this
        }

        return this
    }

    after<T extends keyof ChainMiddlewareName>(name: T) {
        this.graph.after(this.name, name)

        if (this.name.startsWith('lifecycle-')) {
            return this
        }

        const lifecycleName = lifecycleNames

        if (lifecycleName.includes(name)) {
            const nextLifecycleName =
                lifecycleName[lifecycleName.indexOf(name) + 1]

            if (nextLifecycleName) {
                this.graph.before(this.name, nextLifecycleName)
            }

            return this
        }

        return this
    }

    run(session: Session, options: ChainMiddlewareContext) {
        return this.execute(session, options)
    }
}

class DefaultChatChainSender {
    constructor(private readonly config: Config) {}

    private processElements(elements: h[]): h[] {
        return elements
            .filter((element): element is h => {
                if (!element) return false

                if (element.type === 'img') {
                    const src = element.attrs?.['src']
                    return !(
                        typeof src === 'string' && src.startsWith('attachment')
                    )
                }
                return true
            })
            .map((element) => {
                if (element.children?.length) {
                    element.children = this.processElements(element.children)
                }
                return element
            })
    }

    async send(
        session: Session,
        messages: (h[] | h | string)[]
    ): Promise<void> {
        if (!messages?.length) return

        if (
            this.config.isForwardMsg &&
            this.getMessageText(messages).length >
                this.config.forwardMsgMinLength
        ) {
            await this.sendAsForward(session, messages)
            return
        }

        await this.sendAsNormal(session, messages)
    }

    private async sendAsForward(
        session: Session,
        messages: (h[] | h | string)[]
    ): Promise<void> {
        const sendMessages = this.convertToForwardMessages(messages)

        if (
            sendMessages.length < 1 ||
            (sendMessages.length === 1 && sendMessages.join().length === 0)
        ) {
            return
        }

        await session.sendQueued(
            h('message', { forward: true }, ...sendMessages)
        )
    }

    private convertToForwardMessages(messages: (h[] | h | string)[]): h[] {
        const firstMsg = messages[0]

        if (Array.isArray(firstMsg)) {
            return messages.map((msg) => h('message', ...(msg as h[])))
        }

        if (typeof firstMsg === 'object') {
            return [h('message', ...(messages as h[]))]
        }

        if (typeof firstMsg === 'string') {
            return [h.text(firstMsg)]
        }

        throw new Error(`Unsupported message type: ${typeof firstMsg}`)
    }

    private async sendAsNormal(
        session: Session,
        messages: (h[] | h | string)[]
    ): Promise<void> {
        for (const message of messages) {
            const messageFragment = await this.buildMessageFragment(
                session,
                message
            )

            if (!messageFragment?.length) continue

            const processedFragment = this.processElements(messageFragment)
            await session.sendQueued(processedFragment)
        }
    }

    private async buildMessageFragment(
        session: Session,
        message: h[] | h | string
    ): Promise<h[]> {
        const shouldAddQuote =
            this.config.isReplyWithAt &&
            session.isDirect === false &&
            session.messageId

        const messageContent = this.convertMessageToArray(message)

        if (
            messageContent == null ||
            messageContent.length < 1 ||
            (messageContent.length === 1 && messageContent.join().length === 0)
        ) {
            return
        }

        if (!shouldAddQuote) {
            return messageContent
        }

        const quote = h('quote', { id: session.messageId })
        const hasIncompatibleType = messageContent.some(
            (element) => element.type === 'audio' || element.type === 'message'
        )

        return hasIncompatibleType ? messageContent : [quote, ...messageContent]
    }

    private convertMessageToArray(message: h[] | h | string): h[] {
        if (Array.isArray(message)) {
            return message
        }
        if (typeof message === 'string') {
            return [h.text(message)]
        }
        return [message]
    }

    private getMessageText(message: (h[] | h | string)[]) {
        return message
            .map((element) => {
                if (typeof element === 'string') {
                    return element
                }
                if (Array.isArray(element)) {
                    return h.select(element, 'text').toString()
                }
                return element.toString()
            })
            .join(' ')
    }
}

export interface ChainMiddlewareContext {
    config: Config
    ctx: Context
    session: Session
    message: string | h[] | h[][]
    options?: ChainMiddlewareContextOptions
    command?: string
    recallThinkingMessage?: () => Promise<void>
    send: (message: h[][] | h[] | h | string) => Promise<void>
}

export interface ChainMiddlewareContextOptions {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    [key: string]: any
}

export interface ChainMiddlewareName {}

export type ChainMiddlewareFunction = (
    session: Session,
    context: ChainMiddlewareContext
) => Promise<string | h[] | h[][] | ChainMiddlewareRunStatus | null>

export type ChatChainSender = (
    session: Session,
    message: (h[] | h | string)[]
) => Promise<void>

export enum ChainMiddlewareRunStatus {
    SKIPPED = 0,
    STOP = 1,
    CONTINUE = 2
}
