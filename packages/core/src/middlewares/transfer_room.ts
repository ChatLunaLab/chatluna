import { Context } from 'koishi';
import { Config } from '../config';
import { ChainMiddlewareRunStatus, ChatChain } from '../chains/chain';
import { createLogger } from '../utils/logger';
import { checkAdmin, getAllJoinedConversationRoom, transferConversationRoom } from '../chains/rooms';


const logger = createLogger()

export function apply(ctx: Context, config: Config, chain: ChatChain) {
    chain.middleware("transfer_room", async (session, context) => {

        const { command } = context

        if (command !== "transfer_room") return ChainMiddlewareRunStatus.SKIPPED

        let room = context.options.room

        if (room == null && context.options.room_resolve != null) {
            // 尝试完整搜索一次

            const rooms = await getAllJoinedConversationRoom(ctx, session, true)

            const roomId = parseInt(context.options.room_resolve?.name)

            room = rooms.find(room => room.roomName === context.options.room_resolve?.name || room.roomId === roomId)
        }


        if (room == null) {
            context.message = "未找到指定的房间。"
            return ChainMiddlewareRunStatus.STOP
        }

        if (room.roomMasterId !== session.userId && !(await checkAdmin(session))) {
            context.message = "你不是房间的房主，无法转移房间给他人"
            return ChainMiddlewareRunStatus.STOP
        }


        const targetUser = context.options.resolve_user.id as string


        await context.send(`你确定要把房间 ${room.roomName} 转移给用户 ${targetUser} 吗？转移后ta将成为房间的房主，你将失去房主权限。如果你确定要转移，请输入 Y 来确认。`)

        const result = await session.prompt(1000 * 30)

        if (result == null) {
            context.message = "操作超时未确认，已自动取消。"
            return ChainMiddlewareRunStatus.STOP
        } else if (result !== "Y") {
            context.message = "已为你取消操作。"
            return ChainMiddlewareRunStatus.STOP
        }


        await transferConversationRoom(ctx, session, room, targetUser)


        context.message = `已将房间 ${room.roomName} 转移给用户 ${targetUser}`

        return ChainMiddlewareRunStatus.STOP
    }).after("lifecycle-handle_command")
}


declare module '../chains/chain' {
    interface ChainMiddlewareName {
        "transfer_room": never
    }

}