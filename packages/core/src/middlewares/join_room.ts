import { Context } from 'koishi'
import { Config } from '../config'
import { ChainMiddlewareRunStatus, ChatChain } from '../chains/chain'
import {
    checkAdmin,
    joinConversationRoom,
    queryConversationRoom
} from '../chains/rooms'

export function apply(ctx: Context, config: Config, chain: ChatChain) {
    chain
        .middleware('join_room', async (session, context) => {
            const { command } = context

            if (command !== 'join_room') return ChainMiddlewareRunStatus.SKIPPED

            const targetRoom = await queryConversationRoom(
                ctx,
                session,
                context.options.room_resolve.name
            )

            if (targetRoom == null) {
                context.message = session.text('.room_not_found')
                return ChainMiddlewareRunStatus.STOP
            }

            // 检查房间是否可加入

            // 如果为私聊的话，可随意加入，为群聊的话就需要检查该房间是否被添加为群聊。

            if (!session.isDirect && targetRoom.visibility === 'public') {
                // 接下来检查该房间是否被添加到当前的群里

                const roomInGroup =
                    (
                        await ctx.database.get('chathub_room_group_member', {
                            groupId: session.guildId,
                            roomId: targetRoom.roomId
                        })
                    ).length === 1

                if (!roomInGroup) {
                    context.message = session.text('.not_in_group')
                    return ChainMiddlewareRunStatus.STOP
                }
            }

            // 检查房间是否有权限加入。

            if (await checkAdmin(session)) {
                // 空的是因为
            } else if (
                targetRoom.visibility === 'private' &&
                targetRoom.password == null
            ) {
                context.message = session.text('.private_no_password')
                return ChainMiddlewareRunStatus.STOP
            } else if (
                targetRoom.visibility === 'private' &&
                targetRoom.password != null &&
                !session.isDirect
            ) {
                context.message = session.text('.private_group_join')
                return ChainMiddlewareRunStatus.STOP
            }

            if (targetRoom.password) {
                await context.send(
                    session.text('.enter_password', [targetRoom.roomName])
                )
                const result = await session.prompt(1000 * 30)

                if (result == null) {
                    context.message = session.text('.timeout')
                    return ChainMiddlewareRunStatus.STOP
                } else if (result !== targetRoom.password) {
                    context.message = session.text('.wrong_password')
                    return ChainMiddlewareRunStatus.STOP
                }
            }

            await joinConversationRoom(ctx, session, targetRoom)

            context.message = session.text('.success', [targetRoom.roomName])

            return ChainMiddlewareRunStatus.STOP
        })
        .after('lifecycle-handle_command')
}

declare module '../chains/chain' {
    interface ChainMiddlewareName {
        join_room: never
    }
}
