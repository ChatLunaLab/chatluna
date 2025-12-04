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
        create_auth_group: never
    }
    interface ChainMiddlewareContextOptions {
        auth_group_resolve?: {
            name?: string
            requestPreMin?: number
            requestPreDay?: number
            costPerToken?: number
            supportModels?: string[]
            platform?: string
            priority?: number
        }
    }
}
