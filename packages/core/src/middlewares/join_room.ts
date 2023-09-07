import { Context } from 'koishi';
import { Config } from '../config';
import { ChainMiddlewareRunStatus, ChatChain } from '../chains/chain';
import { createLogger } from '../utils/logger';
import { checkAdmin, joinConversationRoom, queryConversationRoom } from '../chains/rooms';


const logger = createLogger()

export function apply(ctx: Context, config: Config, chain: ChatChain) {
    chain.middleware("join_room", async (session, context) => {

        const { command } = context

        if (command !== "join_room") return ChainMiddlewareRunStatus.SKIPPED

        let targetRoom = await queryConversationRoom(ctx, session, context.options.room_resolve.name)


        if (targetRoom == null) {
            context.message = "未找到指定的房间。"
            return ChainMiddlewareRunStatus.STOP
        }

        // 检查房间是否可加入

        // 如果为私聊的话，可随意加入，为群聊的话就需要检查该房间是否被添加为群聊。

        if (!session.isDirect && targetRoom.visibility === "public") {
            // 接下来检查该房间是否被添加到当前的群里

            const roomInGroup = (await ctx.database.get("chathub_room_group_member", {
                groupId: session.guildId,
                roomId: targetRoom.roomId
            })).length == 1

            if (!roomInGroup) {
                context.message = "该房间不在当前群聊中。"
                return ChainMiddlewareRunStatus.STOP
            }
        }

        // 检查房间是否有权限加入。 

        if (await checkAdmin(session)) {
            // 空的是因为
        } else if (targetRoom.visibility === "private" && targetRoom.password == null) {
            context.message = "该房间为私密房间。房主未设置密码加入，只能由房主邀请进入，无法加入。"
            return ChainMiddlewareRunStatus.STOP
        } else if (targetRoom.visibility === "private" && targetRoom.password != null && !session.isDirect) {
            context.message = "该房间为私密房间。由于需要输入密码，你无法在群聊中加入。"
            return ChainMiddlewareRunStatus.STOP
        }

        if (targetRoom.password) {
            await context.send(`请输入密码来加入房间 ${targetRoom.roomName}。`)
            const result = await session.prompt(1000 * 30)

            if (result == null) {
                context.message = "操作超时未确认，已自动取消。"
                return ChainMiddlewareRunStatus.STOP
            } else if (result !== targetRoom.password) {
                context.message = "密码错误，已为你取消操作。"
                return ChainMiddlewareRunStatus.STOP
            }
        }


        await joinConversationRoom(ctx, session, targetRoom)

        context.message = `已加入房间 ${targetRoom.roomName}`

        return ChainMiddlewareRunStatus.STOP
    }).after("lifecycle-handle_command")
}


declare module '../chains/chain' {
    interface ChainMiddlewareName {
        "join_room": never
    }

}