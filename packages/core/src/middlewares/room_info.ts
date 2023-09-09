import { Context } from 'koishi'
import { Config } from '../config'
import { ChainMiddlewareRunStatus, ChatChain } from '../chains/chain'
import { getAllJoinedConversationRoom } from '../chains/rooms'

export function apply(ctx: Context, config: Config, chain: ChatChain) {
    chain
        .middleware('room_info', async (session, context) => {
            const { command } = context

            if (command !== 'room_info') return ChainMiddlewareRunStatus.SKIPPED

            let room = context.options.room

            if (room == null && context.options.room_resolve != null) {
                // 尝试完整搜索一次

                const rooms = await getAllJoinedConversationRoom(ctx, session, true)

                const roomId = parseInt(context.options.room_resolve?.name)

                room = rooms.find(
                    (room) =>
                        room.roomName === context.options.room_resolve?.name ||
                        room.roomId === roomId
                )
            }

            if (room == null) {
                context.message = '未找到指定的房间。'
                return ChainMiddlewareRunStatus.STOP
            }

            const buffer = ['以下是你目前所在的房间信息\n']

            buffer.push(`房间名: ${room.roomName}`)
            buffer.push(`房间ID: ${room.roomId}`)
            buffer.push(`房间预设: ${room.preset}`)
            buffer.push(`房间模型: ${room.model}`)
            buffer.push(`房间可见性: ${room.visibility}`)
            buffer.push(`房间聊天模式: ${room.chatMode}`)
            buffer.push(`房间创建者ID: ${room.roomMasterId}`)

            context.message = buffer.join('\n')

            return ChainMiddlewareRunStatus.STOP
        })
        .after('lifecycle-handle_command')
}

declare module '../chains/chain' {
    interface ChainMiddlewareName {
        room_info: never
    }
}
