import { Context } from 'koishi'
import { ChatHubAuthGroup } from '../../authorization/types'
import { Cache } from '../../cache'
import { ChatChain } from '../../chains/chain'
import { Config } from '../../config'
export declare function apply(
    ctx: Context,
    config: Config,
    chain: ChatChain
): void
declare module '../../chains/chain' {
    interface ChainMiddlewareName {
        chat_time_limit_check: never
    }
    interface ChainMiddlewareContextOptions {
        chatLimitCache?: Cache<'chatluna/chat_limit', ChatLimit>
        chatLimit?: ChatLimit
        authGroup?: ChatHubAuthGroup
    }
}
declare module '@koishijs/cache' {
    interface Tables {
        'chatluna/chat_limit': ChatLimit
    }
}
export interface ChatLimit {
    time: number
    count: number
}
