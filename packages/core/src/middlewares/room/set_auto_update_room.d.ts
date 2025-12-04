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
        set_auto_update_room: never
    }
    interface ChainMiddlewareContextOptions {
        auto_update_room?: boolean
    }
}
