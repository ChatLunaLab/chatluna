import { Context } from 'koishi'
import { Config } from '../config'
import { ChainMiddlewareRunStatus, ChatChain } from '../chains/chain'
import {
    checkAdmin,
    getAllJoinedConversationRoom,
    transferConversationRoom
} from '../chains/rooms'

export function apply(ctx: Context, config: Config, chain: ChatChain) {
    chain
        .middleware('transfer_room', async (session, context) => {
            const { command } = context

            if (command !== 'transfer_room')
                return ChainMiddlewareRunStatus.SKIPPED

            let room = context.options.room

            if (room == null && context.options.room_resolve != null) {
                // 尝试完整搜索一次

                const rooms = await getAllJoinedConversationRoom(
                    ctx,
                    session,
                    true
                )

                const roomId = parseInt(context.options.room_resolve?.name)

                room = rooms.find(
                    (room) =>
                        room.roomName === context.options.room_resolve?.name ||
                        room.roomId === roomId
                )
            }

            if (room == null) {
                context.message = session.text('.room_not_found')
                return ChainMiddlewareRunStatus.STOP
            }

            if (
                room.roomMasterId !== session.userId &&
                !(await checkAdmin(session))
            ) {
                context.message = session.text('.not_room_master')
                return ChainMiddlewareRunStatus.STOP
            }

            const targetUser = context.options.resolve_user.id as string

            await context.send(
                session.text('.confirm_transfer', [room.roomName, targetUser])
            )

            const result = await session.prompt(1000 * 30)

            if (result == null) {
                context.message = session.text('.timeout')
                return ChainMiddlewareRunStatus.STOP
            } else if (result !== 'Y') {
                context.message = session.text('.cancelled')
                return ChainMiddlewareRunStatus.STOP
            }

            await transferConversationRoom(ctx, session, room, targetUser)

            context.message = session.text('.success', [
                room.roomName,
                targetUser
            ])

            return ChainMiddlewareRunStatus.STOP
        })
        .after('lifecycle-handle_command')
}

declare module '../chains/chain' {
    interface ChainMiddlewareName {
        transfer_room: never
    }
}
