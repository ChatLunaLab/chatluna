import { Context } from 'koishi'
import { Config } from '../config'
import { ChainMiddlewareRunStatus, ChatChain } from '../chains/chain'
import {
    checkAdmin,
    getAllJoinedConversationRoom,
    setUserPermission
} from '../chains/rooms'

export function apply(ctx: Context, config: Config, chain: ChatChain) {
    chain
        .middleware('room_permission', async (session, context) => {
            const { command } = context

            if (command !== 'room_permission')
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

            if (
                targetRoom.roomMasterId !== session.userId &&
                !(await checkAdmin(session))
            ) {
                context.message = session.text('.not_admin')
                return ChainMiddlewareRunStatus.STOP
            }

            const user = context.options.resolve_user.id as string

            await context.send(
                session.text('.confirm_set', [user, targetRoom.roomName])
            )

            const result = await session.prompt(1000 * 30)

            if (result == null) {
                context.message = session.text('.timeout')
                return ChainMiddlewareRunStatus.STOP
            } else if (
                ['admin', 'member', 'a', 'm'].every(
                    (text) => result.toLowerCase() !== text
                )
            ) {
                context.message = session.text('.invalid_permission')
                return ChainMiddlewareRunStatus.STOP
            }

            const currentPermission = result.startsWith('a')
                ? 'admin'
                : 'member'

            await setUserPermission(
                ctx,
                session,
                targetRoom,
                currentPermission,
                user
            )

            context.message = session.text('.success', [
                user,
                targetRoom.roomName,
                currentPermission
            ])

            return ChainMiddlewareRunStatus.STOP
        })
        .after('lifecycle-handle_command')
}

declare module '../chains/chain' {
    interface ChainMiddlewareName {
        room_permission: never
    }
}
