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
                context.message = '未找到指定的房间。'
                return ChainMiddlewareRunStatus.STOP
            }

            if (targetRoom.roomMasterId === session.userId) {
                await context.send(
                    '检测到你为房主，当你退出房间时，房间将会被删除。如果你确定要删除，请输入 Y 来确认。'
                )

                const result = await session.prompt(1000 * 30)

                if (result == null) {
                    context.message = '操作超时未确认，已自动取消。'
                    return ChainMiddlewareRunStatus.STOP
                } else if (result !== 'Y') {
                    context.message = '已为你取消操作。'
                    return ChainMiddlewareRunStatus.STOP
                }
            }

            await leaveConversationRoom(ctx, session, targetRoom)

            if (targetRoom.roomMasterId === session.userId) {
                await deleteConversationRoom(ctx, targetRoom)
            }

            context.message = `已退出房间 ${targetRoom.roomName}。您可能需要重新加入或者切换房间。`

            return ChainMiddlewareRunStatus.STOP
        })
        .after('lifecycle-handle_command')
}

declare module '../chains/chain' {
    interface ChainMiddlewareName {
        leave_room: never
    }
}
