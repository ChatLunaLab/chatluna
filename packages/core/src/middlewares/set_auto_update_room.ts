import { Context } from 'koishi'
import { Config } from '../config'
import { ChainMiddlewareRunStatus, ChatChain } from '../chains/chain'
import { checkAdmin, getAllJoinedConversationRoom } from '../chains/rooms'

export function apply(ctx: Context, config: Config, chain: ChatChain) {
    chain
        .middleware('set_auto_update_room', async (session, context) => {
            const { command } = context

            if (command !== 'set_auto_update_room')
                return ChainMiddlewareRunStatus.SKIPPED

            // eslint-disable-next-line @typescript-eslint/naming-convention
            let { room: targetRoom, auto_update_room } = context.options

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

            if (targetRoom.visibility !== 'template_clone') {
                context.message =
                    '该房间不是模板克隆房间，无法设置自动更新属性。'
                return ChainMiddlewareRunStatus.STOP
            }

            if (
                targetRoom.roomMasterId !== session.userId &&
                !(await checkAdmin(session))
            ) {
                context.message = '你不是房间的房主，无法设置自动更新房间。'
                return ChainMiddlewareRunStatus.STOP
            }

            targetRoom.autoUpdate = context.options.auto_update_room

            await ctx.database.upsert('chathub_room', [targetRoom])

            context.message = `已设置房间 ${targetRoom.roomName} 的自动更新属性为 ${auto_update_room}。`

            return ChainMiddlewareRunStatus.STOP
        })
        .after('lifecycle-handle_command')
}

declare module '../chains/chain' {
    interface ChainMiddlewareName {
        set_auto_update_room: never
    }
    interface ChainMiddlewareContextOptions {
        auto_update_room?: boolean
    }
}
