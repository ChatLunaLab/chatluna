import { Context, h, Session } from 'koishi'
import { Config } from '../config'
import '../middlewares/system/lifecycle'
export declare class ChatChain {
    private readonly ctx
    private readonly config
    readonly _graph: ChatChainDependencyGraph
    private readonly _senders
    private isSetErrorMessage
    constructor(ctx: Context, config: Config)
    private _createRecallThinkingMessage
    receiveMessage(session: Session, ctx?: Context): Promise<boolean>
    receiveCommand(
        session: Session,
        command: string,
        options?: ChainMiddlewareContextOptions,
        ctx?: Context
    ): Promise<boolean>

    middleware<T extends keyof ChainMiddlewareName>(
        name: T,
        middleware: ChainMiddlewareFunction,
        ctx?: Context
    ): ChainMiddleware

    sender(sender: ChatChainSender): void
    private _runMiddleware
    private _executeLevel
    private _executeMiddleware
    private sendMessage
    private _handleStopStatus
    private _handleMiddlewareError
}
declare class ChatChainDependencyGraph {
    private readonly _tasks
    private readonly _dependencies
    private readonly _eventEmitter
    private readonly _listeners
    private _cachedOrder
    constructor()
    addNode(middleware: ChainMiddleware): void
    removeNode(name: string): void
    once(name: string, listener: (...args: any[]) => void): void
    before(
        taskA: ChainMiddleware | string,
        taskB: ChainMiddleware | string
    ): void

    after(
        taskA: ChainMiddleware | string,
        taskB: ChainMiddleware | string
    ): void

    getDependencies(task: string): Set<string>
    getDependents(task: string): string[]
    build(): ChainMiddleware[][]
    private _canRunInParallel
    private _hasTransitiveDependency
    private _findAllCycles
}
export declare class ChainMiddleware {
    readonly name: string
    private readonly execute
    private readonly graph
    constructor(
        name: string,
        execute: ChainMiddlewareFunction,
        graph: ChatChainDependencyGraph
    )

    before<T extends keyof ChainMiddlewareName>(name: T): this
    after<T extends keyof ChainMiddlewareName>(name: T): this
    run(
        session: Session,
        options: ChainMiddlewareContext
    ): Promise<string | h[] | h[][] | ChainMiddlewareRunStatus>
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
export declare enum ChainMiddlewareRunStatus {
    SKIPPED = 0,
    STOP = 1,
    CONTINUE = 2
}
export {}
