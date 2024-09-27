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

            const buffer = [session.text('.header') + '\n']

            buffer.push(session.text('.room_name', [room.roomName]))
            buffer.push(session.text('.room_id', [room.roomId]))
            buffer.push(session.text('.room_preset', [room.preset]))
            buffer.push(session.text('.room_model', [room.model]))
            buffer.push(session.text('.room_visibility', [room.visibility]))
            buffer.push(session.text('.room_chat_mode', [room.chatMode]))
            buffer.push(session.text('.room_master_id', [room.roomMasterId]))

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
