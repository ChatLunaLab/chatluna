import { Context, Session, h } from 'koishi';
import { Config } from '../config';

/**
 * ChatChain为消息的发送和接收提供了一个统一的中间提供交互
 */
export class ChatChain {

    private readonly _graph: ChatChainDependencyGraph
    private readonly _senders: ChatChainSender[]

    constructor(
        private readonly ctx: Context,
        private readonly config: Config
    ) { }

    async receiveMessage(
        session: Session
    ) {
        const middlewares = this._graph.build()

        const context: ChainMiddlewareOptions = {
            config: this.config,
            message: session.content,
            ctx: this.ctx,
        }

        for (const middleware of middlewares) {
            let result: boolean | h[]
            try {

                result = await middleware.run(session, context)
            } catch (error) {
                console.error(`[chat-chain] ${middleware.name} error: ${error.message}`)

                return false
            }

            if (result == false) {
                // 中间件说这里不要继续执行了
                return

            } else if (result instanceof Array) {
                context.message = result
            }
        }

        await this.sendMessage(session, context.message)

        return true
    }


    middleware(name: string, middleware: ChainMiddlewareFunction): ChatChainMiddleware {
        const result = new ChatChainMiddleware(name, middleware, this._graph)

        this._graph.addNode(name, result)

        return result
    }

    sender(sender: ChatChainSender) {
        this._senders.push(sender)
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
            from: this._nodeMap[from],
            to: this._nodeMap[to]
        }

        this._edgeMap[`${from}->${to}`] = edge
    }

    before(name: string, target: string) {
        this._addEdge(name, target)
    }

    after(name: string, target: string) {
        this._addEdge(target, name)
    }

    build() {
        // A 依赖 B
        // C 依赖 A
        // D 依赖 C
        // B 依赖 D

        // 应该返回的列表： B -> A -> C -> D
        // 按照上面的注释生成返回的列表的代码

        const result: ChatChainNode[] = []

        const nodeNames = Object.keys(this._nodeMap)
        const edgeNames = Object.keys(this._edgeMap)


        // 1. 找到所有没有依赖的节点
        const noDependenceNodes = nodeNames.filter(nodeName => {
            return !edgeNames.some(edgeName => {
                return edgeName.endsWith(`->${nodeName}`)
            })
        })


        // 2. 从没有依赖的节点开始，递归查找依赖，并且检查图是否为有向无环图
        const buffer = []

        const check = (nodeName: string) => {
            if (buffer.includes(nodeName)) {
                throw new Error(`ChatChainDependencyGraph: 依赖关系中存在环路，${nodeName} 依赖了 ${buffer.join(' -> ')}`)
            }
        }

        const find = (nodeName: string) => {
            check(nodeName)

            const node = this._nodeMap[nodeName]

            if (!node) {
                throw new Error(`ChatChainDependencyGraph: 依赖关系中存在不存在的节点 ${nodeName}`)
            }

            // 2.1. 将当前节点加入缓冲区

            buffer.push(nodeName)

            // 2.2. 检查当前节点是否有依赖
            const edgeName = edgeNames.find(edgeName => {
                return edgeName.startsWith(`${nodeName}->`)
            })

            if (edgeName) {
                // 2.3. 如果有依赖，递归查找依赖
                const nextNodeName = edgeName.split('->')[1]

                find(nextNodeName)
            } else {
                // 2.4. 如果没有依赖，将缓冲区中的节点加入结果列表
                result.push(node)
            }

            // 2.5. 将当前节点从缓冲区中移除
            buffer.pop()
        }

        noDependenceNodes.forEach(nodeName => {
            find(nodeName)
        })

        return result.map(node => node.middleware)

    }

}




interface ChatChainNode {
    name: string
    middleware: ChatChainMiddleware
}

interface ChatChainEdge {
    from: ChatChainNode
    to: ChatChainNode
}

export class ChatChainMiddleware {

    constructor(
        readonly name: string,
        private readonly execute: ChainMiddlewareFunction,
        private readonly graph: ChatChainDependencyGraph
    ) { }

    before(name: string) {
        this.graph.before(this.name, name)
    }

    after(name: string) {
        this.graph.after(this.name, name)
    }

    run(session: Session, options: ChainMiddlewareOptions) {
        return this.execute(session, options)
    }
}

export interface ChainMiddlewareOptions {
    config: Config
    ctx: Context,
    message: string | h[]
    options?: Record<string, string>
}

export type ChainMiddlewareFunction = (session: Session, options: ChainMiddlewareOptions) => Promise<h[] | boolean | null>

export type ChatChainSender = (session: Session, message: h[] | string) => Promise<void>


