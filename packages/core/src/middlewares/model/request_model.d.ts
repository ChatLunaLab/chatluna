import { Context, Session } from 'koishi'
import { ChatChain } from 'koishi-plugin-chatluna/chains'
import { Config } from '../../config'
import { ConversationRoom, Message } from '../../types'
export declare function apply(
    ctx: Context,
    config: Config,
    chain: ChatChain
): void
export declare function getRequestId(
    session: Session,
    room: ConversationRoom
): string
export declare function createRequestId(
    session: Session,
    room: ConversationRoom,
    requestId?: string
): string
declare module '../../chains/chain' {
    interface ChainMiddlewareName {
        request_model: never
    }
    interface ChainMiddlewareContextOptions {
        responseMessage?: Message
        inputMessage?: Message
        queueCount?: number
    }
}
