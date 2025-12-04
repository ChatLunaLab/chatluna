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
        create_room: never
    }
    interface ChainMiddlewareContextOptions {
        room_resolve?: {
            conversationId?: string
            model?: string
            preset?: string
            name?: string
            chatMode?: string
            id?: string
            password?: string
            visibility?: string
        }
    }
}
