import { Context } from 'koishi'
import { Config } from '../config'
import { ChainMiddlewareRunStatus, ChatChain } from '../chains/chain'
import {
    deleteConversationRoom,
    getAllJoinedConversationRoom,
    leaveConversationRoom
} from '../chains/rooms'

export function apply(ctx: Context, config: Config, chain: ChatChain) {
    chain
        .middleware('leave_room', async (session, context) => {
            const { command } = context

            if (command !== 'leave_room')
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

            if (targetRoom.roomMasterId === session.userId) {
                await context.send(session.text('.confirm_delete'))

                const result = await session.prompt(1000 * 30)

                if (result == null) {
                    context.message = session.text('.timeout')
                    return ChainMiddlewareRunStatus.STOP
                } else if (result !== 'Y') {
                    context.message = session.text('.cancelled')
                    return ChainMiddlewareRunStatus.STOP
                }
            }

            await leaveConversationRoom(ctx, session, targetRoom)

            if (targetRoom.roomMasterId === session.userId) {
                await deleteConversationRoom(ctx, targetRoom)
            }

            context.message = session.text('.success', [targetRoom.roomName])

            return ChainMiddlewareRunStatus.STOP
        })
        .after('lifecycle-handle_command')
}

declare module '../chains/chain' {
    interface ChainMiddlewareName {
        leave_room: never
    }
}
