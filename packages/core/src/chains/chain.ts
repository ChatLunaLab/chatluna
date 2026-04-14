import { Context, h, Logger, Session } from 'koishi'
import {
    ChatLunaError,
    ChatLunaErrorCode,
    setErrorFormatTemplate
} from 'koishi-plugin-chatluna/utils/error'
import { createLogger } from 'koishi-plugin-chatluna/utils/logger'
import { Config } from '../config'
import type { ConversationResolution } from '../services/conversation_types'
import { lifecycleNames } from '../middlewares/system/lifecycle'
import { formatDuration } from '../utils/time'
import type { QQBot } from '@koishijs/plugin-adapter-qq'

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

        this._senders.push((session, messages, context) =>
            defaultChatChainSender.send(session, messages, context)
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
            options: {
                startedAt: Date.now()
            },
            send: (message) => this.sendMessage(session, message, context),
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
            send: (message) => this.sendMessage(session, message, context),
            recallThinkingMessage: this._createRecallThinkingMessage(
                {} as ChainMiddlewareContext
            ),
            options: {
                ...options,
                startedAt: Date.now()
            }
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
            await this.sendMessage(session, context.message, context)
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
                    `middleware %c executed in %s`,
                    middleware.name,
                    formatDuration(executionTime)
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
        message: h[] | h[][] | h | string,
        context?: ChainMiddlewareContext
    ) {
        const messages: (h[] | h | string)[] =
            message instanceof Array ? message : [message]

        for (const sender of this._senders) {
            await sender(session, messages, context)
        }
    }

    private async _handleStopStatus(
        session: Session,
        context: ChainMiddlewareContext,
        originMessage: string | h[] | h[][],
        isOutputLog: boolean
    ) {
        if (context.message != null && context.message !== originMessage) {
            await this.sendMessage(session, context.message, context)
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
            await this.sendMessage(session, message, undefined)
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
            ]),
            undefined
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
    private readonly _rules: ChainDependencyRule[] = []
    private readonly _listeners = new Map<
        string,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        Set<(...args: any[]) => void>
    >()

    private _cachedOrder: ChainMiddleware[][] | null = null
    private _index = 0

    public addNode(middleware: ChainMiddleware): void {
        this._tasks.set(middleware.name, {
            name: middleware.name,
            middleware,
            index: this._index++
        })
        this._cachedOrder = null
    }

    removeNode(name: string): void {
        this._tasks.delete(name)
        for (let i = this._rules.length - 1; i >= 0; i--) {
            const rule = this._rules[i]
            if (rule.owner === name || rule.target === name) {
                this._rules.splice(i, 1)
            }
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
            this._rules.push({
                owner: taskA,
                target: taskB,
                type: 'before',
                source: this._captureRuleSource()
            })
            this._cachedOrder = null
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
            this._rules.push({
                owner: taskA,
                target: taskB,
                type: 'after',
                source: this._captureRuleSource()
            })
            this._cachedOrder = null
        } else {
            throw new Error('Invalid tasks')
        }
    }

    getDependencies(task: string) {
        const deps = new Set<string>()

        for (const rule of this._rules) {
            if (rule.owner === task && rule.type === 'after') {
                deps.add(rule.target)
            }

            if (rule.target === task && rule.type === 'before') {
                deps.add(rule.owner)
            }
        }

        return deps
    }

    getDependents(task: string): string[] {
        const dependents: string[] = []

        for (const rule of this._rules) {
            if (rule.owner === task && rule.type === 'before') {
                dependents.push(rule.target)
            }

            if (rule.target === task && rule.type === 'after') {
                dependents.push(rule.owner)
            }
        }

        return dependents
    }

    build(): ChainMiddleware[][] {
        if (this._cachedOrder) {
            return this._cachedOrder
        }

        for (const [, listeners] of this._listeners) {
            for (const listener of listeners) {
                listener()
            }
            listeners.clear()
        }

        const lifecycleSet = new Set(lifecycleNames)
        const nodes = [...this._tasks.values()].sort(
            (a, b) => a.index - b.index
        )
        const nodeNames = new Set(nodes.map((node) => node.name))
        const normalNodes = nodes.filter((node) => !lifecycleSet.has(node.name))
        const ranges = new Map<string, ChainDependencyRange>()
        const outgoing = new Map<string, ChainDependencyEdge[]>()
        const incoming = new Map<string, ChainDependencyEdge[]>()
        const slots = new Map<string, number>()
        const slotCause = new Map<string, ChainDependencyEdge>()

        for (const node of normalNodes) {
            ranges.set(node.name, {
                min: 0,
                max: lifecycleNames.length,
                minRules: [],
                maxRules: []
            })
            outgoing.set(node.name, [])
            incoming.set(node.name, [])
            slots.set(node.name, 0)
        }

        for (const rule of this._rules) {
            if (!nodeNames.has(rule.owner)) {
                continue
            }

            if (!lifecycleSet.has(rule.target) && !nodeNames.has(rule.target)) {
                throw new Error(
                    `Unknown middleware "${rule.target}" referenced by ${this._formatRule(rule)}`
                )
            }

            if (lifecycleSet.has(rule.owner) && lifecycleSet.has(rule.target)) {
                continue
            }

            if (lifecycleSet.has(rule.target) || lifecycleSet.has(rule.owner)) {
                const name = lifecycleSet.has(rule.target)
                    ? rule.owner
                    : rule.target

                if (lifecycleSet.has(name)) {
                    continue
                }

                const range = ranges.get(name)

                if (!range) {
                    continue
                }

                const lifecycleName = lifecycleSet.has(rule.target)
                    ? rule.target
                    : rule.owner
                const idx = lifecycleNames.indexOf(lifecycleName)
                const isAfter = lifecycleSet.has(rule.target)
                    ? rule.type === 'after'
                    : rule.type === 'before'

                if (isAfter) {
                    range.min = Math.max(range.min, idx + 1)
                    range.minRules.push(rule)
                } else {
                    range.max = Math.min(range.max, idx)
                    range.maxRules.push(rule)
                }

                slots.set(name, range.min)
                continue
            }

            const edge: ChainDependencyEdge =
                rule.type === 'before'
                    ? {
                          from: rule.owner,
                          to: rule.target,
                          rule
                      }
                    : {
                          from: rule.target,
                          to: rule.owner,
                          rule
                      }

            outgoing.get(edge.from)?.push(edge)
            incoming.get(edge.to)?.push(edge)
        }

        const stack: string[] = []
        const onStack = new Set<string>()
        const index = new Map<string, number>()
        const lowLink = new Map<string, number>()
        const cycles: string[][] = []
        let cursor = 0

        const visit = (name: string) => {
            index.set(name, cursor)
            lowLink.set(name, cursor)
            cursor += 1
            stack.push(name)
            onStack.add(name)

            for (const edge of outgoing.get(name) ?? []) {
                const next = edge.to

                if (!index.has(next)) {
                    visit(next)
                    lowLink.set(
                        name,
                        Math.min(lowLink.get(name)!, lowLink.get(next)!)
                    )
                    continue
                }

                if (onStack.has(next)) {
                    lowLink.set(
                        name,
                        Math.min(lowLink.get(name)!, index.get(next)!)
                    )
                }
            }

            if (lowLink.get(name) !== index.get(name)) {
                return
            }

            const group: string[] = []

            while (true) {
                const current = stack.pop()!
                onStack.delete(current)
                group.push(current)

                if (current === name) {
                    break
                }
            }

            if (
                group.length > 1 ||
                (outgoing.get(group[0]) ?? []).some(
                    (edge) => edge.to === group[0]
                )
            ) {
                cycles.push(group)
            }
        }

        for (const node of normalNodes) {
            if (!index.has(node.name)) {
                visit(node.name)
            }
        }

        if (cycles.length > 0) {
            const cycle = cycles[0]
            const cycleSet = new Set(cycle)
            const blocked = new Set<string>()
            const queue = [...cycle]

            while (queue.length > 0) {
                const current = queue.shift()!

                for (const edge of outgoing.get(current) ?? []) {
                    if (cycleSet.has(edge.to) || blocked.has(edge.to)) {
                        continue
                    }

                    blocked.add(edge.to)
                    queue.push(edge.to)
                }
            }

            const order = new Map(nodes.map((node) => [node.name, node.index]))
            const cycleEdges = cycle
                .flatMap((name) => outgoing.get(name) ?? [])
                .filter((edge) => cycleSet.has(edge.to))
                .sort(
                    (a, b) =>
                        (order.get(a.from) ?? 0) - (order.get(b.from) ?? 0) ||
                        (order.get(a.to) ?? 0) - (order.get(b.to) ?? 0)
                )
            const blockedList = [...blocked].sort(
                (a, b) => (order.get(a) ?? 0) - (order.get(b) ?? 0)
            )

            throw new Error(
                [
                    'Circular dependency detected in middleware graph.',
                    `Cycle nodes: ${cycle
                        .sort(
                            (a, b) => (order.get(a) ?? 0) - (order.get(b) ?? 0)
                        )
                        .join(' -> ')}`,
                    'Constraints:',
                    ...cycleEdges.map(
                        (edge) =>
                            `- ${edge.from} -> ${edge.to} via ${this._formatRule(edge.rule)}`
                    ),
                    blockedList.length > 0
                        ? `Blocked nodes: ${blockedList.join(', ')}`
                        : ''
                ]
                    .filter((line) => line.length > 0)
                    .join('\n')
            )
        }

        const indegree = new Map<string, number>()

        for (const node of normalNodes) {
            indegree.set(node.name, incoming.get(node.name)?.length ?? 0)
        }

        const ready = normalNodes
            .filter((node) => indegree.get(node.name) === 0)
            .map((node) => node.name)
        const topo: string[] = []

        while (ready.length > 0) {
            ready.sort(
                (a, b) =>
                    (this._tasks.get(a)?.index ?? 0) -
                    (this._tasks.get(b)?.index ?? 0)
            )

            const current = ready.shift()!
            const currentSlot = slots.get(current) ?? 0
            const range = ranges.get(current)

            if (range && currentSlot > range.max) {
                const path: string[] = []
                let name = current
                const visited = new Set<string>()

                while (slotCause.has(name) && !visited.has(name)) {
                    visited.add(name)
                    const edge = slotCause.get(name)!
                    path.unshift(
                        `- ${edge.from} -> ${edge.to} via ${this._formatRule(edge.rule)}`
                    )
                    name = edge.from
                }

                throw new Error(
                    [
                        `Cannot place middleware "${current}" in lifecycle order.`,
                        `Resolved position: ${this._formatSlot(currentSlot)}`,
                        `Latest allowed position: ${this._formatSlot(range.max)}`,
                        range.minRules.length > 0 ? 'Required after:' : '',
                        ...range.minRules.map(
                            (rule) => `- ${this._formatRule(rule)}`
                        ),
                        range.maxRules.length > 0 ? 'Required before:' : '',
                        ...range.maxRules.map(
                            (rule) => `- ${this._formatRule(rule)}`
                        ),
                        path.length > 0 ? 'Dependency chain:' : '',
                        ...path
                    ]
                        .filter((line) => line.length > 0)
                        .join('\n')
                )
            }

            topo.push(current)

            for (const edge of outgoing.get(current) ?? []) {
                if ((slots.get(edge.to) ?? 0) < currentSlot) {
                    slots.set(edge.to, currentSlot)
                    slotCause.set(edge.to, edge)
                }

                indegree.set(edge.to, (indegree.get(edge.to) ?? 0) - 1)

                if (indegree.get(edge.to) === 0) {
                    ready.push(edge.to)
                }
            }
        }

        const levels: ChainMiddleware[][] = []
        const slotGroups = new Map<number, string[]>()

        for (const name of topo) {
            const slot = slots.get(name) ?? 0
            const group = slotGroups.get(slot) ?? []
            group.push(name)
            slotGroups.set(slot, group)
        }

        for (let slot = 0; slot <= lifecycleNames.length; slot++) {
            const group = slotGroups.get(slot) ?? []

            if (group.length > 0) {
                const groupSet = new Set(group)
                const groupIndegree = new Map<string, number>()

                for (const name of group) {
                    groupIndegree.set(
                        name,
                        (incoming.get(name) ?? []).filter((edge) =>
                            groupSet.has(edge.from)
                        ).length
                    )
                }

                let currentLevel = group
                    .filter((name) => groupIndegree.get(name) === 0)
                    .sort(
                        (a, b) =>
                            (this._tasks.get(a)?.index ?? 0) -
                            (this._tasks.get(b)?.index ?? 0)
                    )

                while (currentLevel.length > 0) {
                    levels.push(
                        currentLevel.map((name) => {
                            const task = this._tasks.get(name)
                            if (task?.middleware == null) {
                                throw new Error(
                                    `Missing middleware for task ${name}`
                                )
                            }
                            return task.middleware
                        })
                    )

                    const nextLevel: string[] = []

                    for (const name of currentLevel) {
                        for (const edge of outgoing.get(name) ?? []) {
                            if (!groupSet.has(edge.to)) {
                                continue
                            }

                            groupIndegree.set(
                                edge.to,
                                (groupIndegree.get(edge.to) ?? 0) - 1
                            )

                            if (groupIndegree.get(edge.to) === 0) {
                                nextLevel.push(edge.to)
                            }
                        }
                    }

                    currentLevel = nextLevel.sort(
                        (a, b) =>
                            (this._tasks.get(a)?.index ?? 0) -
                            (this._tasks.get(b)?.index ?? 0)
                    )
                }
            }

            const lifecycle = this._tasks.get(lifecycleNames[slot])?.middleware

            if (lifecycle) {
                levels.push([lifecycle])
            }
        }

        this._cachedOrder = levels
        return levels
    }

    private _captureRuleSource() {
        const stack = new Error().stack?.split('\n') ?? []

        return stack
            .map((line) => line.trim())
            .find(
                (line) =>
                    line.length > 0 &&
                    line !== 'Error' &&
                    !line.includes('ChatChainDependencyGraph.') &&
                    !line.includes('ChainMiddleware.') &&
                    !line.includes('chains\\chain.') &&
                    !line.includes('chains/chain.')
            )
    }

    private _formatRule(rule: ChainDependencyRule) {
        const source = rule.source ? ` at ${rule.source}` : ''
        return `.${rule.type}('${rule.target}') declared by ${rule.owner}${source}`
    }

    private _formatSlot(slot: number) {
        if (slot <= 0) {
            return `before ${lifecycleNames[0]}`
        }

        if (slot >= lifecycleNames.length) {
            return `after ${lifecycleNames[lifecycleNames.length - 1]}`
        }

        return `between ${lifecycleNames[slot - 1]} and ${lifecycleNames[slot]}`
    }
}

interface ChainDependencyGraphNode {
    middleware?: ChainMiddleware
    name: string
    index: number
}

interface ChainDependencyRule {
    owner: string
    target: string
    type: 'before' | 'after'
    source?: string
}

interface ChainDependencyEdge {
    from: string
    to: string
    rule: ChainDependencyRule
}

interface ChainDependencyRange {
    min: number
    max: number
    minRules: ChainDependencyRule[]
    maxRules: ChainDependencyRule[]
}

export class ChainMiddleware {
    constructor(
        readonly name: string,
        private readonly execute: ChainMiddlewareFunction,
        private readonly graph: ChatChainDependencyGraph
    ) {}

    before<T extends keyof ChainMiddlewareName>(name: T) {
        this.graph.before(this.name, name)

        return this
    }

    after<T extends keyof ChainMiddlewareName>(name: T) {
        this.graph.after(this.name, name)

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
        messages: (h[] | h | string)[],
        context?: ChainMiddlewareContext
    ): Promise<void> {
        if (!messages?.length) return

        if (
            isElementArray(messages?.[0]) &&
            messages[0][1]?.type === 'markdown-qq'
        ) {
            await this.sendAsQQMarkdown(session, messages[0][0])
            return
        }

        if (
            this.config.isForwardMsg &&
            this.getMessageText(messages).length >
                this.config.forwardMsgMinLength
        ) {
            await this.sendAsForward(session, messages)
            return
        }

        await this.sendAsNormal(session, messages, context)
    }

    private async sendAsQQMarkdown(
        session: Session,
        message: h
    ): Promise<void> {
        const { user } = session.event
        // only support private
        await (session.bot as QQBot<Context>).internal.sendPrivateMessage(
            user.id,
            {
                msg_type: 2,
                msg_seq: 1,
                msg_id: session.messageId,
                markdown: {
                    content: message.attrs['content']
                }
            }
        )
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
        messages: (h[] | h | string)[],
        context?: ChainMiddlewareContext
    ): Promise<void> {
        for (const message of messages) {
            const messageFragment = await this.buildMessageFragment(
                session,
                message,
                context
            )

            if (!messageFragment?.length) continue

            const processedFragment = this.processElements(messageFragment)
            await session.sendQueued(processedFragment)
        }
    }

    private async buildMessageFragment(
        session: Session,
        message: h[] | h | string,
        context?: ChainMiddlewareContext
    ): Promise<h[]> {
        const start = context?.options?.startedAt
        const elapsed = start ? Date.now() - start : 0
        const threshold = (this.config.replyQuoteThreshold ?? 0) * 1000
        const shouldAddQuote =
            this.config.isReplyWithAt &&
            session.isDirect === false &&
            session.messageId &&
            elapsed >= threshold

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
    conversation?: ConversationResolution
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
    message: (h[] | h | string)[],
    context?: ChainMiddlewareContext
) => Promise<void>

export enum ChainMiddlewareRunStatus {
    SKIPPED = 0,
    STOP = 1,
    CONTINUE = 2
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function isElementArray(value: any): value is h[] {
    return (
        Array.isArray(value) &&
        value.every(
            (item) => typeof item === 'object' && item.attrs && item.type
        )
    )
}
