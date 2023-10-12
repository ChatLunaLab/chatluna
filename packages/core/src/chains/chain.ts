import { Context, h, Session } from 'koishi'
import { Config } from '../config'
import { createLogger } from '../utils/logger'
import { lifecycleNames } from '../middlewares/lifecycle'
import EventEmitter from 'events'
import { ChatHubError } from '../utils/error'

const logger = createLogger()

/**
 * ChatChain为消息的发送和接收提供了一个统一的中间提供交互
 */
export class ChatChain {
    public readonly _graph: ChatChainDependencyGraph
    private readonly _senders: ChatChainSender[]

    constructor(
        private readonly ctx: Context,
        private readonly config: Config
    ) {
        this._graph = new ChatChainDependencyGraph()
        this._senders = []

        const defaultChatChainSender = new DefaultChatChainSender(config)

        this._senders.push((session, messages) =>
            defaultChatChainSender.send(session, messages)
        )
    }

    async receiveMessage(session: Session) {
        const context: ChainMiddlewareContext = {
            config: this.config,
            message: session.content,
            ctx: this.ctx,
            options: {},
            send: (message) => this.sendMessage(session, message),
            recallThinkingMessage: async () => {}
        }

        context.recallThinkingMessage = async () => {
            if (context.options?.thinkingTimeoutObject) {
                clearTimeout(context.options.thinkingTimeoutObject.timeout!)

                if (context.options.thinkingTimeoutObject.autoRecallTimeout) {
                    clearTimeout(
                        context.options.thinkingTimeoutObject.autoRecallTimeout!
                    )
                }

                if (context.options.thinkingTimeoutObject.recallFunc) {
                    await context.options.thinkingTimeoutObject.recallFunc()
                }
                if (context.options?.thinkingTimeoutObject?.timeout) {
                    context.options.thinkingTimeoutObject.timeout = null
                }
                context.options.thinkingTimeoutObject = undefined
            }
        }

        const result = await this._runMiddleware(session, context)

        await context.recallThinkingMessage()

        return result
    }

    async receiveCommand(
        session: Session,
        command: string,
        options: ChainMiddlewareContextOptions = {}
    ) {
        const context: ChainMiddlewareContext = {
            config: this.config,
            message: options?.message ?? session.content,
            ctx: this.ctx,
            command,
            send: (message) => this.sendMessage(session, message),
            recallThinkingMessage: async () => {},
            options
        }

        context.recallThinkingMessage = async () => {
            if (context.options.thinkingTimeoutObject) {
                clearTimeout(context.options.thinkingTimeoutObject.timeout!)
                if (context.options.thinkingTimeoutObject.recallFunc) {
                    await context.options.thinkingTimeoutObject.recallFunc()
                }
                if (context.options?.thinkingTimeoutObject?.timeout) {
                    context.options.thinkingTimeoutObject.timeout = null
                }
                context.options.thinkingTimeoutObject = undefined
            }
        }

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

        ctx.on('dispose', () => {
            this._graph.removeNode(name)
        })

        return result
    }

    sender(sender: ChatChainSender) {
        this._senders.push(sender)
    }

    private async _runMiddleware(
        session: Session,
        context: ChainMiddlewareContext
    ) {
        // 手动 polyfill，呃呃呃呃呃
        if (session.isDirect == null) {
            session.isDirect = session.subtype === 'private'
        }

        const originMessage = context.message

        const runList = this._graph.build()

        if (runList.length === 0) {
            return false
        }

        let isOutputLog = false

        for (const middleware of runList) {
            let result: ChainMiddlewareRunStatus | h[] | h | h[][] | string

            let executedTime = Date.now()

            try {
                result = await middleware.run(session, context)

                executedTime = Date.now() - executedTime
            } catch (error) {
                if (error instanceof ChatHubError) {
                    await this.sendMessage(session, error.message)
                    return false
                }

                logger.error(`chat-chain: ${middleware.name} error ${error}`)

                logger.error(error)

                if (error.cause) {
                    logger.error(error.cause)
                }
                logger.debug('-'.repeat(20) + '\n')

                await this.sendMessage(
                    session,
                    `执行 ${middleware.name} 时出现错误: ${error.message}`
                )

                return false
            }

            if (
                !middleware.name.startsWith('lifecycle-') &&
                ChainMiddlewareRunStatus.SKIPPED !== result &&
                middleware.name !== 'allow_reply' &&
                executedTime > 10
            ) {
                logger.debug(
                    `chat-chain: ${middleware.name} executed in ${executedTime}ms`
                )
                isOutputLog = true
            }

            if (result === ChainMiddlewareRunStatus.STOP) {
                // 中间件说这里不要继续执行了
                if (
                    context.message != null &&
                    context.message !== originMessage
                ) {
                    // 消息被修改了
                    await this.sendMessage(session, context.message)
                }

                if (isOutputLog) {
                    logger.debug('-'.repeat(20) + '\n')
                }

                return false
            } else if (result instanceof Array || typeof result === 'string') {
                context.message = result
            }
        }

        if (isOutputLog) {
            logger.debug('-'.repeat(20) + '\n')
        }

        if (context.message != null && context.message !== originMessage) {
            // 消息被修改了
            await this.sendMessage(session, context.message)
        }

        return true
    }

    private async sendMessage(
        session: Session,
        message: h[] | h[][] | h | string
    ) {
        // check if message is a two-dimensional array

        const messages: (h[] | h | string)[] =
            message instanceof Array ? message : [message]

        for (const sender of this._senders) {
            await sender(session, messages)
        }
    }
}

// 定义一个有向无环图类，包含节点集合和邻接表
class ChatChainDependencyGraph {
    private _tasks: ChainDependencyGraphNode[] = []

    private _dependencies: Map<string, Set<string>> = new Map()

    private _eventEmitter: EventEmitter = new EventEmitter()

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    private _listeners: Map<string, ((...args: any[]) => void)[]> = new Map()

    constructor() {
        this._eventEmitter.on('build_node', () => {
            for (const [name, listeners] of this._listeners.entries()) {
                for (const listener of listeners) {
                    listener(name)
                }
                listeners.length = 0
            }
        })
    }

    // Add a task to the DAG.
    public addNode(middleware: ChainMiddleware): void {
        this._tasks.push({
            name: middleware.name,
            middleware
        })
    }

    removeNode(name: string): void {
        const index = this._tasks.findIndex((task) => task.name === name)
        if (index !== -1) {
            this._tasks.splice(index, 1)
        }

        // remove dependencies

        for (const [, dependencies] of this._dependencies.entries()) {
            if (dependencies.has(name)) {
                dependencies.delete(name)
            }
        }

        if (this._dependencies[name]) {
            delete this._dependencies[name]
        }
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    once(name: string, listener: (...args: any[]) => void) {
        if (this._listeners.has(name)) {
            this._listeners.get(name)!.push(listener)
        } else {
            this._listeners.set(name, [listener])
        }
    }

    // Set a dependency between two tasks
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
            // Add taskB to the dependencies of taskA
            const dependencies = this._dependencies.get(taskA) ?? new Set()
            dependencies.add(taskB)
            this._dependencies.set(taskA, dependencies)
        } else {
            throw new Error('Invalid tasks')
        }
    }

    // Set a reverse dependency between two tasks
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
            // Add taskB to the dependencies of taskA
            const dependencies = this._dependencies.get(taskB) ?? new Set()
            dependencies.add(taskA)
            this._dependencies.set(taskB, dependencies)
        } else {
            throw new Error('Invalid tasks')
        }
    }

    // Get dependencies of a task
    getDependencies(task: string) {
        return this._dependencies.get(task)
    }

    // Get dependents of a task
    getDependents(task: string): string[] {
        const dependents: string[] = []
        for (const [key, value] of this._dependencies.entries()) {
            if ([...value].includes(task)) {
                dependents.push(key)
            }
        }
        return dependents
    }

    // Build a two-dimensional array of tasks based on their dependencies
    build(): ChainMiddleware[] {
        this._eventEmitter.emit('build_node')

        // Create an array to store the result
        const result: ChainMiddleware[] = []
        // Create a map to store the indegree of each task
        const indegree: Map<string, number> = new Map()
        // Initialize the indegree map with zero for each task
        for (const task of this._tasks) {
            indegree.set(task.name, 0)
        }
        // Iterate over the tasks and increment the indegree of their dependencies
        for (const [, dependencies] of this._dependencies.entries()) {
            for (const dependency of dependencies) {
                indegree.set(dependency, indegree.get(dependency) + 1)
            }
        }

        // Create a queue to store the tasks with zero indegree
        const queue: string[] = []
        // Enqueue the tasks with zero indegree
        for (const [task, degree] of indegree.entries()) {
            if (degree === 0) {
                queue.push(task)
            }
        }
        // While the queue is not empty
        while (queue.length > 0) {
            // Create an array to store the current level of tasks

            // Dequeue all the tasks in the queue and add them to the level
            while (queue.length > 0) {
                const task = queue.shift()
                result.push(
                    this._tasks.find((t) => t.name === task)!.middleware!
                )
                // For each dependency of the dequeued task
                for (const dep of this._dependencies.get(task) ?? []) {
                    // Decrement its indegree by one
                    indegree.set(dep, indegree.get(dep) - 1)
                    // If its indegree becomes zero, enqueue it to the queue
                    if (indegree.get(dep) === 0) {
                        queue.push(dep)
                    }
                }
            }
        }
        // Return the result
        return result
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

        // 现在我们需要基于当前添加的依赖，去寻找这个依赖锚定的生命周期

        // 如果当前添加的依赖是生命周期，那么我们需要找到这个生命周期的下一个生命周期
        if (lifecycleName.includes(name)) {
            const lastLifecycleName =
                lifecycleName[lifecycleName.indexOf(name) - 1]

            if (lastLifecycleName) {
                this.graph.after(this.name, lastLifecycleName)
            }

            return this
        }

        // 如果不是的话，我们就需要寻找依赖锚定的生命周期

        this.graph.once('build_node', () => {
            const beforeMiddlewares = [
                ...this.graph.getDependencies(name)
            ].filter((name) => name.startsWith('lifecycle-'))

            const afterMiddlewares = this.graph
                .getDependents(name)
                .filter((name) => name.startsWith('lifecycle-'))

            for (const before of beforeMiddlewares) {
                this.graph.before(this.name, before)
            }

            for (const after of afterMiddlewares) {
                this.graph.after(this.name, after)
            }
        })

        return this
    }

    after<T extends keyof ChainMiddlewareName>(name: T) {
        this.graph.after(this.name, name)

        if (this.name.startsWith('lifecycle-')) {
            return this
        }

        const lifecycleName = lifecycleNames

        // 现在我们需要基于当前添加的依赖，去寻找这个依赖锚定的生命周期

        // 如果当前添加的依赖是生命周期，那么我们需要找到这个生命周期的下一个生命周期
        if (lifecycleName.includes(name)) {
            const nextLifecycleName =
                lifecycleName[lifecycleName.indexOf(name) + 1]

            if (nextLifecycleName) {
                this.graph.before(this.name, nextLifecycleName)
            }

            return this
        }

        // 如果不是的话，我们就需要寻找依赖锚定的生命周期
        this.graph.once('build_node', () => {
            const beforeMiddlewares = [
                ...this.graph.getDependencies(name)
            ].filter((name) => name.startsWith('lifecycle-'))

            const afterMiddlewares = this.graph
                .getDependents(name)
                .filter((name) => name.startsWith('lifecycle-'))

            for (const before of beforeMiddlewares) {
                this.graph.before(this.name, before)
            }

            for (const after of afterMiddlewares) {
                this.graph.after(this.name, after)
            }
        })

        return this
    }

    run(session: Session, options: ChainMiddlewareContext) {
        return this.execute(session, options)
    }
}

class DefaultChatChainSender {
    constructor(private readonly config: Config) {}

    async send(session: Session, messages: (h[] | h | string)[]) {
        if (this.config.isForwardMsg) {
            const sendMessages: h[] = []

            if (messages[0] instanceof Array) {
                // h[][]
                for (const message of messages) {
                    sendMessages.push(h('message', ...(message as h[])))
                }
            } else if (messages[0] instanceof Object) {
                // h | h[]
                sendMessages.push(h('message', ...(messages as h[])))
            } else if (typeof messages[0] === 'string') {
                // string
                sendMessages.push(h.text(messages[0] as string))
            } else {
                throw new Error(`unknown message type: ${typeof messages[0]}`)
            }

            await session.sendQueued(
                h(
                    'message',
                    {
                        forward: true
                    },
                    ...sendMessages
                )
            )
        } else {
            for (const message of messages) {
                let messageFragment: h[]

                if (this.config.isReplyWithAt && session.isDirect === false) {
                    messageFragment = [h('quote', { id: session.messageId })]

                    if (message instanceof Array) {
                        messageFragment = messageFragment.concat(message)
                    } else if (typeof message === 'string') {
                        messageFragment.push(h.text(message))
                    } else {
                        messageFragment.push(message)
                    }

                    for (const element of messageFragment) {
                        // 语音,消息 不能引用
                        if (
                            element.type === 'audio' ||
                            element.type === 'message'
                        ) {
                            messageFragment.shift()
                            break
                        }
                    }
                } else {
                    if (message instanceof Array) {
                        messageFragment = message
                    } else if (typeof message === 'string') {
                        messageFragment = [h.text(message)]
                    } else {
                        // 你就说是不是 element 吧
                        messageFragment = [message]
                    }
                }

                await session.sendQueued(messageFragment)
            }
        }
    }
}

export interface ChainMiddlewareContext {
    config: Config
    ctx: Context
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
