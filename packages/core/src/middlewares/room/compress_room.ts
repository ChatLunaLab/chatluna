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
                const key =
                    context.options.i18n_base ??
                    'commands.chatluna.room.compress.messages'

                context.message = session.text(`${key}.no_room`)
                return ChainMiddlewareRunStatus.STOP
            }

            try {
                const key =
                    context.options.i18n_base ??
                    'commands.chatluna.room.compress.messages'
                const result = await ctx.chatluna.compressContext(
                    targetRoom,
                    context.options.force === true
                )
                const args = [
                    result.inputTokens,
                    result.outputTokens,
                    result.reducedPercent.toFixed(2)
                ]

                context.message = session.text(
                    result.compressed ? `${key}.success` : `${key}.skipped`,
                    args
                )
            } catch (error) {
                ctx.logger.error(error)
                const key =
                    context.options.i18n_base ??
                    'commands.chatluna.room.compress.messages'

                context.message = session.text(`${key}.failed`, [
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
