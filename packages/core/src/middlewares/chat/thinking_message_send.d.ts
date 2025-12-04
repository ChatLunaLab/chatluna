import { Context } from 'koishi'
import { Config } from '../../config'
import { ChatChain } from '../../chains/chain'
export declare function apply(
    ctx: Context,
    config: Config,
    chain: ChatChain
): void
export interface ThinkingTimeoutObject {
    timeout?: NodeJS.Timeout
    recallFunc?: () => PromiseLike<void>
    autoRecallTimeout?: NodeJS.Timeout
}
declare module '../../chains/chain' {
    interface ChainMiddlewareContextOptions {
        thinkingTimeoutObject?: ThinkingTimeoutObject
    }
    interface ChainMiddlewareName {
        thinking_message_send: never
    }
}
