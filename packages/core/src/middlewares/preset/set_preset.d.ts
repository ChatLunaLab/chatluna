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
        set_preset: string
    }
    interface ChainMiddlewareContextOptions {
        setPreset?: string
    }
}
