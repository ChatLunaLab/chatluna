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

            if ((context.command?.length ?? 0) > 1) {
                // 强制继续
                return ChainMiddlewareRunStatus.CONTINUE
            }

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

            const modelName =
                room?.model == null ||
                room.model.trim().length < 1 ||
                room.model === '无' ||
                room.model === 'empty'
                    ? 'empty'
                    : room.model

            await context.send(
                session.text('chatluna.room.unavailable', [modelName])
            )

            try {
                const success = await fixConversationRoomAvailability(
                    ctx,
                    config,
                    room
                )

                if (!success) {
                    return ChainMiddlewareRunStatus.STOP
                }
            } catch (error) {
                logger.error(error)
                return ChainMiddlewareRunStatus.STOP
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
