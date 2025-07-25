import { Context } from 'koishi'
import { Config } from '../../config'
import { ChainMiddlewareRunStatus, ChatChain } from '../../chains/chain'
import {
    checkConversationRoomAvailability,
    fixConversationRoomAvailability
} from '../../chains/rooms'
import { logger } from '../..'

export function apply(ctx: Context, config: Config, chain: ChatChain) {
    chain
        .middleware('resolve_model', async (session, context) => {
            const { room } = context.options

            let isAvailable: boolean

            try {
                isAvailable = await checkConversationRoomAvailability(ctx, room)
            } catch (e) {
                logger.error(e)
                return ChainMiddlewareRunStatus.STOP
            }

            if (isAvailable) {
                return ChainMiddlewareRunStatus.CONTINUE
            }

            await context.send(session.text('chatluna.room.unavailable'))

            try {
                await fixConversationRoomAvailability(ctx, config, room)
            } catch (error) {
                logger.error(error)
            }

            return ChainMiddlewareRunStatus.CONTINUE
        })
        .before('check_room')
        .after('resolve_room')
}

declare module '../../chains/chain' {
    interface ChainMiddlewareName {
        resolve_model: never
    }
}
