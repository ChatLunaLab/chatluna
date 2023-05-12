import { Context, Session, h } from 'koishi';
import { Config } from './config';
import { Cache } from "./cache"
import { createLogger } from '@dingyi222666/chathub-llm-core/lib/utils/logger';
import { format } from 'path';
import { lifecycleNames } from './middlewares/lifecycle';

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
    }

    async receiveMessage(
        session: Session
    ) {

        const context: ChainMiddlewareContext = {
            config: this.config,
            message: session.content,
            ctx: this.ctx,
        }

        return await this._runMiddleware(session, context)
    }


    async receiveCommand(
        session: Session,
        command: string,
        options?: Record<string, any>
    ) {

        const context: ChainMiddlewareContext = {
            config: this.config,
            message: (options.message as string | null) ?? session.content,
            ctx: this.ctx,
            command,
            options
        }


        return await this._runMiddleware(session, context)
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

        const originMessagee = context.message

        const runList = this._graph.build()

        if (runList.length == 0) {
            return true
        }

        for (const middlewares of runList) {
            while (middlewares.length > 0) {
                const middleware = middlewares.shift()!

                let result: boolean | h[] | string

                let executedTime = Date.now()

                try {

                    result = await middleware.run(session, context)

                    executedTime = Date.now() - executedTime
                } catch (error) {
                    logger.debug(`[chat-chain] ${middleware.name} error: ${error.message}`)

                    return false
                }

                if (!middleware.name.startsWith("lifecycle-")) {
                    logger.debug(`[chat-chain] ${middleware.name} executed in ${executedTime}ms`)
                }

                if (result == false) {
                    logger.debug(`[chat-chain] ${middleware.name} return false`)
                    // 中间件说这里不要继续执行了
                    if (context.message !== originMessagee) {
                        // 消息被修改了
                        await this.sendMessage(session, context.message)
                    }
                    return false
                } else if (result instanceof Array) {
                    context.message = result
                }
            }
        }
        return true
    }

    private async sendMessage(
        session: Session,
        message: h[] | string
    ) {
        for (const sender of this._senders) {
            await sender(session, message)
        }
    }
}


// 定义一个有向无环图类，包含节点集合和邻接表
class ChatChainDependencyGraph {

    private _tasks: ChainDependencyGraphNode[] = []

    private _dependencies: Map<string, string[]> = new Map()

    constructor() { }

    // Add a task to the DAG.
    public addNode(middleware: ChainMiddleware): void {
        this._tasks.push({
            name: middleware.name,
            middleware
        })
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
            const dependencies = this._dependencies.get(taskA) ?? []
            dependencies.push(taskB)
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
            const dependencies = this._dependencies.get(taskB) ?? []
            dependencies.push(taskA)
            this._dependencies.set(taskB, dependencies)
        } else {
            throw new Error("Invalid tasks");
        }
    }


    // Build a two-dimensional array of tasks based on their dependencies
    build(): ChainMiddleware[][] {
        // Create an array to store the result
        let result: ChainMiddleware[][] = [];
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
            let level: string[] = [];
            // Dequeue all the tasks in the queue and add them to the level
            while (queue.length > 0) {
                let task = queue.shift();
                level.push(task);
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
            // Add the current level to the result
            result.push(level.map(name => this._tasks.find(task => task.name == name)!.middleware!));
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
        return this
    }

    after<T extends keyof ChainMiddlewareName>(name:
        T) {
        this.graph.after(this.name, name)
        return this
    }

    inLifecycle<T extends keyof ChainMiddlewareName >(lifecycle: T) {
        const lifecycleName = lifecycleNames

        if (!lifecycleName.includes(lifecycle)) {
            throw new Error(`[chat-chain] lifecycle ${lifecycle} is not exists`)
        }

        const nextLifecycle = lifecycleName.indexOf(lifecycle) > 0 ? lifecycleName[lifecycleName.indexOf(lifecycle) + 1] : null

        this.after(lifecycle)

        if (nextLifecycle) {
            this.before(nextLifecycle as any)
        }
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
    message: string | h[]
    options?: ChainMiddlewareContextOptions,
    command?: string
}

export interface ChainMiddlewareContextOptions {
    [key: string]: any
}

export interface ChainMiddlewareName { }

export type ChainMiddlewareFunction = (session: Session, context: ChainMiddlewareContext) => Promise<string | h[] | boolean | null>

export type ChatChainSender = (session: Session, message: h[] | string) => Promise<void>

export type CommandSelector = (command: string, options?: Record<string, any>) => boolean


