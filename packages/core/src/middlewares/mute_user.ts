import { Context } from 'koishi'
import { Config } from '../config'
import { ChainMiddlewareRunStatus, ChatChain } from '../chains/chain'
import {
    checkAdmin,
    getAllJoinedConversationRoom,
    getConversationRoomUser,
    muteUserFromConversationRoom
} from '../chains/rooms'

export function apply(ctx: Context, config: Config, chain: ChatChain) {
    chain
        .middleware('mute_user', async (session, context) => {
            let {
                command,
                options: { room }
            } = context

            if (command !== 'mute_user') return ChainMiddlewareRunStatus.SKIPPED

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

            const userInfo = await getConversationRoomUser(
                ctx,
                session,
                room,
                session.userId
            )

            if (
                userInfo.roomPermission === 'member' &&
                !(await checkAdmin(session))
            ) {
                context.message = session.text('.not_admin', [room.roomName])
                return ChainMiddlewareRunStatus.STOP
            }

            const targetUser = context.options.resolve_user.id as string[]

            for (const user of targetUser) {
                await muteUserFromConversationRoom(ctx, session, room, user)
            }

            context.message = session.text('.success', [
                targetUser.join(','),
                room.roomName
            ])

            return ChainMiddlewareRunStatus.STOP
        })
        .after('lifecycle-handle_command')
}

declare module '../chains/chain' {
    interface ChainMiddlewareName {
        mute_user: never
    }
}
