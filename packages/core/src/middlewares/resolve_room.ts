import { Context, h, Query } from 'koishi';
import { Config } from '../config';

import { ConversationRoom } from '../types';
import { v4 as uuidv4 } from 'uuid';
import { getKeysCache } from '..';
import { createLogger } from '../llm-core/utils/logger';
import { resolveModelProvider } from './chat_time_limit_check';
import { ChainMiddlewareRunStatus, ChatChain } from '../chains/chain';
import { getDefaultConversationRoom, getConversationRoomCount, getTemplateConversationRoom, createConversationRoom, queryPublicConversationRoom } from '../chains/rooms';

const logger = createLogger("@dingyi222666/chathub/middlewares/resolve_room")

export function apply(ctx: Context, config: Config, chain: ChatChain) {
    chain.middleware("resolve_room", async (session, context) => {


        let joinRoom = await getDefaultConversationRoom(ctx, session)

        if (joinRoom == null) {
            joinRoom = await queryPublicConversationRoom(ctx, session)
        }

        if (joinRoom == null) {
            // 尝试基于模板房间创建房间

            const templateRoom = await getTemplateConversationRoom(ctx)

            if (templateRoom == null) {
                // 没有就算了。后面需要房间的中间件直接报错就完事。
                return ChainMiddlewareRunStatus.SKIPPED
            }

            const cloneRoom = structuredClone(templateRoom)

            cloneRoom.conversationId = uuidv4()

            // 如果是群聊的公共房间，那么就房主直接设置为群主，否则就是私聊
            cloneRoom.roomMasterId = session.isDirect ? session.userId : (await session.bot.getGuildMemberList(session.guildId)).filter(it => it.roles.includes("owner"))[0].userId

            cloneRoom.visibility = session.isDirect ? 'private' : 'public'

            cloneRoom.roomId = ((await getConversationRoomCount(ctx)) + 1).toString()

            cloneRoom.roomName = session.isDirect ? `${session.username} 的私有房间` : `${session.guildName} 的公共房间`

            await createConversationRoom(ctx, session, cloneRoom)

            joinRoom = cloneRoom
        }

        context.options.room = joinRoom

        return ChainMiddlewareRunStatus.CONTINUE
    }).after("lifecycle-prepare")
    //  .before("lifecycle-request_model")
}

export type ChatMode = "plugin" | "chat" | "browsing"

declare module '../chains/chain' {
    interface ChainMiddlewareContextOptions {
        room?: ConversationRoom

        setModel?: string
    }

    interface ChainMiddlewareName {
        "resolve_room": never
    }
}