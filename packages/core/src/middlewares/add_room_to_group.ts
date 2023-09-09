import { Context } from 'koishi'
import { Config } from '../config'
import { ChainMiddlewareRunStatus, ChatChain } from '../chains/chain'
import { createLogger } from '../utils/logger'
import {
    addConversationRoomToGroup,
    checkAdmin,
    getAllJoinedConversationRoom
} from '../chains/rooms'

const logger = createLogger()

export function apply(ctx: Context, config: Config, chain: ChatChain) {
    chain
        .middleware('add_room_to_group', async (session, context) => {
            const { command } = context

            if (command !== 'add_room_to_group') return ChainMiddlewareRunStatus.SKIPPED
            let { room: targetRoom, room_resolve } = context.options

            if (targetRoom == null && room_resolve != null) {
                // 尝试完整搜索一次

                const rooms = await getAllJoinedConversationRoom(ctx, session, true)

                const roomId = parseInt(room_resolve?.name)

                targetRoom = rooms.find(
                    (room) => room.roomName === room_resolve?.name || room.roomId === roomId
                )
            }

            if (targetRoom == null) {
                context.message = '未找到指定的房间。'
                return ChainMiddlewareRunStatus.STOP
            }

            if (targetRoom.roomMasterId !== session.userId && !(await checkAdmin(session))) {
                context.message = '你不是房间的房主，无法执行此操作。'
                return ChainMiddlewareRunStatus.STOP
            }

            await addConversationRoomToGroup(
                ctx,
                session,
                targetRoom,
                context.options.resolve_user.id as string
            )

            context.message = `已将房间 ${targetRoom.roomName} 添加到群组 ${context.options.resolve_user.id}。`

            return ChainMiddlewareRunStatus.STOP
        })
        .after('lifecycle-handle_command')
}

declare module '../chains/chain' {
    interface ChainMiddlewareName {
        add_room_to_group: never
    }
}
