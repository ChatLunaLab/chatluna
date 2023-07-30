import { Context, h } from 'koishi';
import { Config } from '../config';
import { ChainMiddlewareRunStatus, ChatChain } from '../chains/chain';
import { createLogger } from '../llm-core/utils/logger';
import { checkAdmin, deleteConversationRoom, getAllJoinedConversationRoom, setUserPermission, switchConversationRoom } from '../chains/rooms';
import { ConversationRoom } from '../types';


const logger = createLogger("@dingyi222666/chathub/middlewares/delete_room")

export function apply(ctx: Context, config: Config, chain: ChatChain) {
    chain.middleware("room_permission", async (session, context) => {

        const { command } = context

        if (command !== "roomPermission") return ChainMiddlewareRunStatus.SKIPPED

        let targetRoom = context.options.room

        if (targetRoom == null && context.options.room_resolve != null) {
            // 尝试完整搜索一次

            const rooms = await getAllJoinedConversationRoom(ctx, session, true)

            const roomId = parseInt(context.options.room_resolve?.name)

            targetRoom = rooms.find(room => room.roomName === context.options.room_resolve?.name || room.roomId === roomId)
        }


        if (targetRoom == null) {
            context.message = "未找到指定的房间。"
            return ChainMiddlewareRunStatus.STOP
        }

        if (targetRoom.roomMasterId !== session.userId  && !checkAdmin(session)) {
            context.message = "你不是房间的房主，无法为用户设置权限。"
            return ChainMiddlewareRunStatus.STOP
        }


        const user = context.options.resolve_user.id as string

        await context.send(`你确定要为用户 ${user} 设置房间 ${targetRoom.roomName} 的权限吗？目前可以设置的权限为 member 和 admin。如果你确定要设置，请输入设置权限的值或首字母大写，其他输入均视为取消。`)

        const result = await session.prompt(1000 * 30)

        if (result == null) {
            context.message = "操作超时未确认，已自动取消。"
            return ChainMiddlewareRunStatus.STOP
        } else if (['admin', 'member', 'a', 'm'].every(text => result.toLowerCase() === text)) {
            context.message = "你输入的权限值不正确，已自动取消。"
            return ChainMiddlewareRunStatus.STOP
        }

        const currentPermission = result.startsWith("a") ? "admin" : "member"

        await setUserPermission(ctx, session, targetRoom, user, currentPermission)

        context.message = `已为用户 ${user} 设置房间 ${targetRoom.roomName} 的权限为 ${currentPermission}`

        return ChainMiddlewareRunStatus.STOP
    }).after("lifecycle-handle_command")
}


declare module '../chains/chain' {
    interface ChainMiddlewareName {
        "room_permission": never
    }

}