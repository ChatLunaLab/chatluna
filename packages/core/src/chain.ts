import { Context, Session, h } from 'koishi';
import { Config } from './config';
import { Cache } from "./cache"
import { createLogger } from '@dingyi222666/chathub-llm-core/lib/utils/logger';
import { format } from 'path';
import { lifecycleNames } from './middlewares/lifecycle';
import EventEmitter from 'events';

const logger = createLogger("@dingyi222666/chathub/chain")

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
        this._senders.push(async (session, message) => {
            await session.send(message)
        })
    }

    async receiveMessage(
        session: Session
    ) {

        const context: ChainMiddlewareContext = {
            config: this.config,
            message: session.content,
            ctx: this.ctx,
            options: {}
        }

        const result = await this._runMiddleware(session, context)


        if (context.options.thinkingTimeoutObject) {
            clearTimeout(context.options.thinkingTimeoutObject.timeout!)
            if (context.options.thinkingTimeoutObject.recallFunc) {
                await context.options.thinkingTimeoutObject.recallFunc()
            }
        }

        return result
    }


    async receiveCommand(
        session: Session,
        command: string,
        options: Record<string, any> = {}
    ) {

        const context: ChainMiddlewareContext = {
            config: this.config,
            message: options?.message ?? session.content,
            ctx: this.ctx,
            command,
            options
        }


        const result = await this._runMiddleware(session, context)


        if (context.options.thinkingTimeoutObject) {
            clearTimeout(context.options.thinkingTimeoutObject.timeout!)
            if (context.options.thinkingTimeoutObject.recallFunc) {
                await context.options.thinkingTimeoutObject.recallFunc()
            }
        }

        return result
    }


    middleware<T extends keyof ChainMiddlewareName>(name:
        T, middleware: ChainMiddlewareFunction): ChainMiddleware {
        const result = new ChainMiddleware(name, middleware, this._graph)

        this._graph.addNode(result)

        return result
    }

    sender(sender: ChatChainSender) {
        this._senders.push(sender)
    }

    private async _runMiddleware(
        session: Session,
        context: ChainMiddlewareContext,
    ) {

        const originMessage = context.message

        const runList = this._graph.build()

        if (runList.length === 0) {
            return false
        }

        for (const middleware of runList) {

            let result: boolean | h[] | h | h[][] | string

            let executedTime = Date.now()

            try {

                result = await middleware.run(session, context)

                executedTime = Date.now() - executedTime
            } catch (error) {
                logger.debug(`[chat-chain] ${middleware.name} error: ${error}`)
                logger.debug(error)

                await this.sendMessage(session, `执行 ${middleware.name} 时出现错误: ${error.message}`)


                return false
            }

            if (!middleware.name.startsWith("lifecycle-")) {
                logger.debug(`[chat-chain] ${middleware.name} executed in ${executedTime}ms`)
            }

            if (result === false) {
                logger.debug(`[chat-chain] ${middleware.name} return ${result}`)
                // 中间件说这里不要继续执行了
                if (context.message !== originMessage) {
                    // 消息被修改了
                    await this.sendMessage(session, context.message)
                }

                return false
            } else if (result instanceof Array) {
                context.message = result
            }

        }



        this.sendMessage(session, context.message)

        return true
    }

    private async sendMessage(
        session: Session,
        message: h[] | h[][] | h | string
    ) {
        // check if message is a two-dimensional array

        const messages: (h[] | h | string)[] = []

        if (Array.isArray(message) && Array.isArray(message[0])) {
            for (const messageItem of message) {
                messages.push(messageItem)
            }
        } else {
            messages.push(message as h[] | h | string)
        }


        for (const sender of this._senders) {
            for (const message of messages) {
                await sender(session, message)
            }
        }
    }
}


// 定义一个有向无环图类，包含节点集合和邻接表
class ChatChainDependencyGraph {

    private _tasks: ChainDependencyGraphNode[] = []

    private _dependencies: Map<string, Set<string>> = new Map()

    private _eventEmitter: EventEmitter = new EventEmitter()

    private _listeners: Map<string, ((...args: any[]) => void)[]> = new Map()

    constructor() {
        this._eventEmitter.on("build_node", () => {
            for (const [name, listeners] of this._listeners.entries()) {
                for (const listener of listeners) {
                    listener(name)
                }
                listeners.splice(0, listeners.length)
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

    once(name: string, listener: (...args: any[]) => void) {
        if (this._listeners.has(name)) {
            this._listeners.get(name)!.push(listener)
        } else {
            this._listeners.set(name, [listener])
        }
    }

    // Set a dependency between two tasks
    before(taskA: ChainMiddleware | string, taskB: ChainMiddleware | string): void {
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
            throw new Error("Invalid tasks");
        }
    }
    // Set a reverse dependency between two tasks
    after(taskA: ChainMiddleware | string, taskB: ChainMiddleware | string): void {
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
            throw new Error("Invalid tasks");
        }
    }

    // Get dependencies of a task
    getDependencies(task: string) {
        return this._dependencies.get(task)
    }

    // Get dependents of a task
    getDependents(task: string): string[] {
        let dependents: string[] = [];
        for (let [key, value] of this._dependencies.entries()) {
            if ([...value].includes(task)) {
                dependents.push(key);
            }
        }
        return dependents;
    }

    // Build a two-dimensional array of tasks based on their dependencies
    build(): ChainMiddleware[] {

        this._eventEmitter.emit("build_node")

        // Create an array to store the result
        let result: ChainMiddleware[] = [];
        // Create a map to store the indegree of each task
        let indegree: Map<string, number> = new Map();
        // Initialize the indegree map with zero for each task
        for (let task of this._tasks) {
            indegree.set(task.name, 0);
        }
        // Iterate over the tasks and increment the indegree of their dependencies
        for (let [task, dependencies] of this._dependencies.entries()) {
            for (let dependency of dependencies) {
                indegree.set(dependency, indegree.get(dependency) + 1);
            }
        }


        // Create a queue to store the tasks with zero indegree
        let queue: string[] = [];
        // Enqueue the tasks with zero indegree
        for (let [task, degree] of indegree.entries()) {
            if (degree === 0) {
                queue.push(task);
            }
        }
        // While the queue is not empty
        while (queue.length > 0) {
            // Create an array to store the current level of tasks

            // Dequeue all the tasks in the queue and add them to the level
            while (queue.length > 0) {
                let task = queue.shift();
                result.push(this._tasks.find(t => t.name === task)!.middleware!)
                // For each dependency of the dequeued task
                for (let dep of this._dependencies.get(task) ?? []) {
                    // Decrement its indegree by one
                    indegree.set(dep, indegree.get(dep) - 1);
                    // If its indegree becomes zero, enqueue it to the queue
                    if (indegree.get(dep) === 0) {
                        queue.push(dep);
                    }
                }
            }

        }
        // Return the result
        return result;
    }


}


interface ChainDependencyGraphNode {
    middleware?: ChainMiddleware
    name: string
}



export class ChainMiddleware {
    private _commandSelector: CommandSelector | null = null

    constructor(
        readonly name: string,
        private readonly execute: ChainMiddlewareFunction,
        private readonly graph: ChatChainDependencyGraph
    ) { }

    before<T extends keyof ChainMiddlewareName>(name:
        T) {
        this.graph.before(this.name, name)

        if (this.name.startsWith('lifecycle-')) {
            return this
        }

        const lifecycleName = lifecycleNames

        // 现在我们需要基于当前添加的依赖，去寻找这个依赖锚定的生命周期

        // 如果当前添加的依赖是生命周期，那么我们需要找到这个生命周期的下一个生命周期
        if (lifecycleName.includes(name)) {
            const lastLifecycleName = lifecycleName[lifecycleName.indexOf(name) - 1]

            if (lastLifecycleName) {
                this.graph.after(this.name, lastLifecycleName)
            }

            return this
        }


        // 如果不是的话，我们就需要寻找依赖锚定的生命周期

        this.graph.once('build_node', () => {

            const befores = [...this.graph.getDependencies(name)].filter(name => name.startsWith('lifecycle-'))
            const afters = this.graph.getDependents(name)
                .filter(name => name.startsWith('lifecycle-'))

            for (const before of befores) {
                this.graph.before(this.name, before)
            }

            for (const after of afters) {
                this.graph.after(this.name, after)
            }
        })

        return this
    }

    after<T extends keyof ChainMiddlewareName>(name:
        T) {
        this.graph.after(this.name, name)

        if (this.name.startsWith('lifecycle-')) {
            return this
        }

        const lifecycleName = lifecycleNames

        // 现在我们需要基于当前添加的依赖，去寻找这个依赖锚定的生命周期

        // 如果当前添加的依赖是生命周期，那么我们需要找到这个生命周期的下一个生命周期
        if (lifecycleName.includes(name)) {
            const nextLifecycleName = lifecycleName[lifecycleName.indexOf(name) + 1]

            if (nextLifecycleName) {
                this.graph.before(this.name, nextLifecycleName)
            }

            return this
        }


        // 如果不是的话，我们就需要寻找依赖锚定的生命周期
        this.graph.once('build_node', () => {

            const befores = [...this.graph.getDependencies(name)].filter(name => name.startsWith('lifecycle-'))
            const afters = this.graph.getDependents(name)
                .filter(name => name.startsWith('lifecycle-'))

            for (const before of befores) {
                this.graph.before(this.name, before)
            }

            for (const after of afters) {
                this.graph.after(this.name, after)
            }
        })

        return this
    }



    run(session: Session, options: ChainMiddlewareContext) {
        return this.execute(session, options)
    }

    commandSelector(selector: CommandSelector) {
        this._commandSelector = selector
        return this
    }

    runCommandSelector(command: string, options?: Record<string, any>) {
        return this._commandSelector(command, options)
    }

}

export interface ChainMiddlewareContext {
    config: Config
    ctx: Context,
    message: string | h[] | h[][]
    options?: ChainMiddlewareContextOptions,
    command?: string
}

export interface ChainMiddlewareContextOptions {
    [key: string]: any
}

export interface ChainMiddlewareName { }

export type ChainMiddlewareFunction = (session: Session, context: ChainMiddlewareContext) => Promise<string | h[] | h[][] | boolean | null>

export type ChatChainSender = (session: Session, message: h[] | h | string) => Promise<void>

export type CommandSelector = (command: string, options?: Record<string, any>) => boolean


