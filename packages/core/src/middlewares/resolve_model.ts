import { Context } from 'koishi'
import { Config } from '../config'
import { ChainMiddlewareRunStatus, ChatChain } from '../chains/chain'
import {
    checkConversationRoomAvailability,
    fixConversationRoomAvailability
} from '../chains/rooms'

export function apply(ctx: Context, config: Config, chain: ChatChain) {
    chain
        .middleware('resolve_model', async (session, context) => {
            const { room } = context.options

            const isAvailable = await checkConversationRoomAvailability(
                ctx,
                room
            )

            if (isAvailable) {
                return ChainMiddlewareRunStatus.CONTINUE
            }

            await context.send(session.text('chatluna.room.unavailable'))

            await fixConversationRoomAvailability(ctx, config, room)

            return ChainMiddlewareRunStatus.CONTINUE
        })
        .before('request_model')
}

declare module '../chains/chain' {
    interface ChainMiddlewareName {
        resolve_model: never
    }
}
