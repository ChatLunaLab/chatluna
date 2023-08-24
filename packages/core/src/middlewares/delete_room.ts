import { Context, h } from 'koishi';
import { Config } from '../config';
import { ChainMiddlewareRunStatus, ChatChain } from '../chains/chain';
import { createLogger } from '../llm-core/utils/logger';
import { checkAdmin, deleteConversationRoom, getAllJoinedConversationRoom, switchConversationRoom } from '../chains/rooms';
import { ConversationRoom } from '../types';


const logger = createLogger("@dingyi222666/chathub/middlewares/delete_room")

export function apply(ctx: Context, config: Config, chain: ChatChain) {
    chain.middleware("delete_room", async (session, context) => {

        const { command } = context

        if (command !== "deleteRoom") return ChainMiddlewareRunStatus.SKIPPED

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

        if (targetRoom.roomMasterId !== session.userId  && !(await checkAdmin(session))) {
            context.message = "你不是房间的房主，无法删除房间。"
            return ChainMiddlewareRunStatus.STOP
        }

        await context.send(`你确定要删除房间 ${targetRoom.roomName} 吗？这将会删除房间内的所有消息。并且成员也会被移除。如果你确定要删除，请输入 Y 来确认。`)

        const result = await session.prompt(1000 * 30)

        if (result == null) {
            context.message = "操作超时未确认，已自动取消。"
            return ChainMiddlewareRunStatus.STOP
        } else if (result !== "Y") { 
            context.message = "已为你取消操作。"
            return ChainMiddlewareRunStatus.STOP
        }


        await deleteConversationRoom(ctx, session, targetRoom)


        context.message = `已删除房间 ${targetRoom.roomName}`

        return ChainMiddlewareRunStatus.STOP
    }).after("lifecycle-handle_command")
}


declare module '../chains/chain' {
    interface ChainMiddlewareName {
        "delete_room": never
    }

}