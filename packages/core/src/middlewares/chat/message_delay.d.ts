import { Context } from 'koishi'
import { Config } from '../../config'
import { ChatChain } from '../../chains/chain'
export declare function apply(
    ctx: Context,
    config: Config,
    chain: ChatChain
): void
declare module '../../chains/chain' {
    interface ChainMiddlewareName {
        message_delay: never
    }
    interface ChainMiddlewareContextOptions {
        messageId?: string
    }
}
