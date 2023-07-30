import { Context, h } from 'koishi';
import { Config } from '../config';
import { ChainMiddlewareRunStatus, ChatChain } from '../chains/chain';
import { createLogger } from '../llm-core/utils/logger';
import { checkAdmin, deleteConversationRoom, getAllJoinedConversationRoom, getConversationRoomUser, joinConversationRoom, kickUserFromConversationRoom, leaveConversationRoom, queryConversationRoom, switchConversationRoom } from '../chains/rooms';
import { ConversationRoom } from '../types';


const logger = createLogger("@dingyi222666/chathub/middlewares/invite_room")

export function apply(ctx: Context, config: Config, chain: ChatChain) {
    chain.middleware("kick_member", async (session, context) => {

        const { command } = context

        if (command !== "kickMember") return ChainMiddlewareRunStatus.SKIPPED

        let targetRoom = context.options.room

        if (targetRoom == null) {
            context.message = "你没有在当前环境里指定房间。请使用 chathub.room.switch 命令来切换房间"
            return ChainMiddlewareRunStatus.STOP
        }

        const userInfo = await getConversationRoomUser(ctx, session, targetRoom, session.userId)

        if (userInfo.roomPermission === "member" && !checkAdmin(session)) {
          
            context.message = `你不是房间 ${targetRoom.roomName} 的管理员，无法踢出用户。`
            return ChainMiddlewareRunStatus.STOP
        }

        const targetUser = context.options.resolve_user.id as string[]

        for (const user of targetUser) {
            await kickUserFromConversationRoom(ctx, session, targetRoom, user)
        }

        context.message = `已将以下用户踢出房间 ${targetRoom.roomName}：${targetUser.join(",")}`

        return ChainMiddlewareRunStatus.STOP
    }).after("lifecycle-handle_command")
}


declare module '../chains/chain' {
    interface ChainMiddlewareName {
        "kick_member": never
    }
}