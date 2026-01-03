import { Context } from 'koishi'
import { Config } from '../../config'
import { ChainMiddlewareRunStatus, ChatChain } from '../../chains/chain'
import { getAllJoinedConversationRoom } from '../../chains/rooms'

export function apply(ctx: Context, config: Config, chain: ChatChain) {
    chain
        .middleware('compress_room', async (session, context) => {
            const { command } = context

            if (command !== 'compress_room')
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
                context.message = session.text('.no_room')
                return ChainMiddlewareRunStatus.STOP
            }

            try {
                await ctx.chatluna.compressContext(targetRoom)
                context.message = session.text('.success', [
                    targetRoom.roomName
                ])
            } catch (error) {
                ctx.logger.error(error)
                context.message = session.text('.failed', [
                    targetRoom.roomName,
                    error.message
                ])
            }

            return ChainMiddlewareRunStatus.STOP
        })
        .after('lifecycle-handle_command')
        .before('lifecycle-request_model')
}

declare module '../../chains/chain' {
    interface ChainMiddlewareName {
        compress_room: never
    }
}
