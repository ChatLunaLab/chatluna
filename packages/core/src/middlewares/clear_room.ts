import { Context, h } from 'koishi';
import { Config } from '../config';
import { ChainMiddlewareRunStatus, ChatChain } from '../chains/chain';
import { createLogger } from '../llm-core/utils/logger';
import { checkAdmin, deleteConversationRoom, getAllJoinedConversationRoom, getConversationRoomUser, switchConversationRoom } from '../chains/rooms';
import { ConversationRoom } from '../types';


const logger = createLogger("@dingyi222666/chathub/middlewares/delete_room")

export function apply(ctx: Context, config: Config, chain: ChatChain) {
    chain.middleware("clear_room", async (session, context) => {

        const { command } = context

        if (command !== "clearRoom") return ChainMiddlewareRunStatus.SKIPPED

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

        const userInfo = await getConversationRoomUser(ctx, session, targetRoom, session.userId)

        if (userInfo.roomPermission === "member"  && !checkAdmin(session)) {
            context.message = `你不是房间 ${targetRoom.roomName} 的管理员，无法踢出用户。`
            return ChainMiddlewareRunStatus.STOP
        }

        await ctx.chathub.clearInterface(targetRoom)

        context.message = `已清除房间 ${targetRoom.roomName} 的聊天记录。`

        return ChainMiddlewareRunStatus.STOP
    }).after("lifecycle-handle_command")
}


declare module '../chains/chain' {
    interface ChainMiddlewareName {
        "clear_room": never
    }

}