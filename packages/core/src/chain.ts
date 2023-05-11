import { Context, Session, h } from 'koishi';
import { Config } from './config';
import { Cache } from "./cache"
import { createLogger } from '@dingyi222666/chathub-llm-core/lib/utils/logger';

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
        const middlewares = this._graph.build()

        const context: ChainMiddlewareContext = {
            config: this.config,
            message: session.content,
            ctx: this.ctx,
        }

        return await this._runMiddleware(session, context, middlewares)
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

        const middlewares = this._graph.build(context)

        return await this._runMiddleware(session, context, middlewares)
    }


    middleware(name: string, middleware: ChainMiddlewareFunction): ChatChainMiddleware {
        const result = new ChatChainMiddleware(name, middleware, this._graph)

        this._graph.addNode(name, result)

        return result
    }

    sender(sender: ChatChainSender) {
        this._senders.push(sender)
    }

    private async _runMiddleware(
        session: Session,
        context: ChainMiddlewareContext,
        middlewares: ChatChainMiddleware[]
    ) {

        const originMessagee = context.message

        for (const middleware of middlewares) {
            let result: boolean | h[] | string
            try {

                result = await middleware.run(session, context)
            } catch (error) {
                console.error(`[chat-chain] ${middleware.name} error: ${error.message}`)

                return false
            }

            if (result == false) {
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


// 有向无环图
// 用于描述聊天链的依赖关系
class ChatChainDependencyGraph {
    private readonly _nodeMap: Record<string, ChatChainNode> = {}
    private readonly _edgeMap: Record<string, ChatChainEdge> = {}

    addNode(name: string, middleware: ChatChainMiddleware) {
        const node = {
            name,
            middleware
        }

        this._nodeMap[name] = node
    }

    private _addEdge(from: string, to: string) {
        const edge = {
            from: from,
            to: to
        }

        this._edgeMap[`${from}->${to}`] = edge
    }

    before(name: string, target: string) {
        this._addEdge(name, target)
    }

    after(name: string, target: string) {
        this._addEdge(target, name)
    }

    build(context?: ChainMiddlewareContext) {
        // 一个依赖可以有多个依赖者，但是一个依赖者也能有多个依赖
        // 总是从没有依赖的节点开始，找到所有依赖
        // 然后按照依赖的顺序返回
        // 按照上面的注释生成返回的列表的代码
        const result: ChatChainNode[] = []

        const nodeNames = Object.keys(this._nodeMap)
        const edgeNames = Object.keys(this._edgeMap)
        const nodeMap = this._nodeMap
        const edgeMap = this._edgeMap

        const stack: string[] = [] // 用一个栈来存储没有依赖的节点
        
        const visited: Record<string, boolean> = {} // 用一个map来存储已经访问过的节点

        // 从没有依赖的节点开始
        for (const nodeName of nodeNames) {
            if (edgeNames.some(edgeName => edgeMap[edgeName].to == nodeName)) {
                // 有依赖
                continue
            }

            stack.push(nodeName)
        }

        while (stack.length > 0) {
            const nodeName = stack.pop()!
            if (visited[nodeName]) {
                continue
            }

            visited[nodeName] = true

            const node = nodeMap[nodeName]

            if (context?.command && node.middleware && !node.middleware.runCommandSelector(context?.command,context?.options)) {
                continue
            }

            result.push(node)

            // 找到所有依赖
            for (const edgeName of edgeNames) {
                if (edgeMap[edgeName]?.from == nodeName) {
                    stack.push(edgeMap[edgeName]?.to)
                }
            }
        }



        return result.map(node => node.middleware)
    }
}



interface ChatChainNode {
    name: string
    middleware: ChatChainMiddleware
}

interface ChatChainEdge {
    from: string
    to: string
}

export class ChatChainMiddleware {

    private _commandSelector: CommandSelector | null = null

    constructor(
        readonly name: string,
        private readonly execute: ChainMiddlewareFunction,
        private readonly graph: ChatChainDependencyGraph
    ) { }

    before(name: string) {
        this.graph.before(this.name, name)
        return this
    }

    after(name: string) {
        this.graph.after(this.name, name)
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
    message: string | h[]
    options?: ChainMiddlewareContextOptions,
    command?: string
}

export interface ChainMiddlewareContextOptions {
    [key: string]: any
}

export type ChainMiddlewareFunction = (session: Session, context: ChainMiddlewareContext) => Promise<string | h[] | boolean | null>

export type ChatChainSender = (session: Session, message: h[] | string) => Promise<void>

export type CommandSelector = (command: string, options?: Record<string, any>) => boolean


