import { Context } from 'koishi'
import { Config } from '../config'
import { ChainMiddlewareRunStatus, ChatChain } from '../chains/chain'
import { getAllJoinedConversationRoom } from '../chains/rooms'

export function apply(ctx: Context, config: Config, chain: ChatChain) {
    chain
        .middleware('clear_room', async (session, context) => {
            const { command } = context

            if (command !== 'clear_room')
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
                context.message = session.text('.no-room')
                return ChainMiddlewareRunStatus.STOP
            }

            /*
            const userInfo = await getConversationRoomUser(
                ctx,
                session,
                targetRoom,
                session.userId
            )

            if (
                userInfo.roomPermission === 'member' &&
                !(await checkAdmin(session))
            ) {
                context.message = `你不是房间 ${targetRoom.roomName} 的管理员，无法清除聊天记录。`
                return ChainMiddlewareRunStatus.STOP
            } */

            await ctx.chatluna.clearChatHistory(targetRoom)

            context.message = session.text('.success', [targetRoom.roomName])

            return ChainMiddlewareRunStatus.STOP
        })
        .after('lifecycle-handle_command')
}

declare module '../chains/chain' {
    interface ChainMiddlewareName {
        clear_room: never
    }
}
