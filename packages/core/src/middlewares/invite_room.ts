import { Context } from 'koishi'
import { Config } from '../config'
import { ChainMiddlewareRunStatus, ChatChain } from '../chains/chain'
import {
    checkAdmin,
    getConversationRoomUser,
    joinConversationRoom
} from '../chains/rooms'

export function apply(ctx: Context, config: Config, chain: ChatChain) {
    chain
        .middleware('invite_room', async (session, context) => {
            const { command } = context

            if (command !== 'invite_room')
                return ChainMiddlewareRunStatus.SKIPPED

            const targetRoom = context.options.room

            if (targetRoom == null) {
                context.message = session.text('.no_room_specified')
                return ChainMiddlewareRunStatus.STOP
            }

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
                context.message = session.text('.not_admin', [
                    targetRoom.roomName
                ])
                return ChainMiddlewareRunStatus.STOP
            }

            const targetUser = context.options.resolve_user.id as string[]

            for (const user of targetUser) {
                await joinConversationRoom(
                    ctx,
                    session,
                    targetRoom,
                    session.isDirect,
                    user
                )
            }

            context.message = session.text('.success', [
                targetUser.join(','),
                targetRoom.roomName
            ])

            return ChainMiddlewareRunStatus.STOP
        })
        .after('lifecycle-handle_command')
}

declare module '../chains/chain' {
    interface ChainMiddlewareName {
        invite_room: never
    }

    interface ChainMiddlewareContextOptions {
        resolve_user?: {
            id: string | string[]
        }
    }
}
