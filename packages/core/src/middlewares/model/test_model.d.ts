import { Context } from 'koishi'
import { ChatChain } from '../../chains/chain'
import { Config } from '../../config'
export declare function apply(
    ctx: Context,
    config: Config,
    chain: ChatChain
): void
declare module '../../chains/chain' {
    interface ChainMiddlewareName {
        test_model: never
    }
    interface ChainMiddlewareContextOptions {
        model?: string
    }
}
