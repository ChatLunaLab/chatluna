import { Context } from 'koishi'
import { Config } from '../../config'
import { ChatChain } from '../../chains/chain'
export declare function apply(ctx: Context, _: Config, chain: ChatChain): void
declare module '../../chains/chain' {
    interface ChainMiddlewareName {
        add_preset: string
    }
    interface ChainMiddlewareContextOptions {
        addPreset?: string
    }
}
