import { Context } from 'koishi'
import { Config } from '../config'
import { ChainMiddlewareRunStatus, ChatChain } from '../chains/chain'
import {
    checkAdmin,
    deleteConversationRoom,
    getAllJoinedConversationRoom
} from '../chains/rooms'

export function apply(ctx: Context, config: Config, chain: ChatChain) {
    chain
        .middleware('delete_room', async (session, context) => {
            const { command } = context

            if (command !== 'delete_room')
                return ChainMiddlewareRunStatus.SKIPPED

            let targetRoom = context.options.room

            if (targetRoom == null && context.options.room_resolve != null) {
                // 尝试完整搜索一次

                const rooms = await getAllJoinedConversationRoom(
                    ctx,
                    session,
                    true
                )

                const roomId = parseInt(context.options.room_resolve?.name)

                targetRoom = rooms.find(
                    (room) =>
                        room.roomName === context.options.room_resolve?.name ||
                        room.roomId === roomId
                )
            }

            if (targetRoom == null) {
                context.message = session.text('.room_not_found')
                return ChainMiddlewareRunStatus.STOP
            }

            if (
                targetRoom.roomMasterId !== session.userId &&
                !(await checkAdmin(session))
            ) {
                context.message = session.text('.not_room_master')
                return ChainMiddlewareRunStatus.STOP
            }

            await context.send(
                session.text('.confirm_delete', [targetRoom.roomName])
            )

            const result = await session.prompt(1000 * 30)

            if (result == null) {
                context.message = session.text('.timeout')
                return ChainMiddlewareRunStatus.STOP
            } else if (result !== 'Y') {
                context.message = session.text('.cancelled')
                return ChainMiddlewareRunStatus.STOP
            }

            await deleteConversationRoom(ctx, targetRoom)

            context.message = session.text('.success', [targetRoom.roomName])

            return ChainMiddlewareRunStatus.STOP
        })
        .after('lifecycle-handle_command')
}

declare module '../chains/chain' {
    interface ChainMiddlewareName {
        delete_room: never
    }
}
