import { Context, h, Query } from 'koishi';
import { Config } from '../config';

import { ConversationRoom } from '../types';
import { v4 as uuidv4 } from 'uuid';
import { getKeysCache } from '..';
import { createLogger } from '../llm-core/utils/logger';
import { resolveModelProvider } from './chat_time_limit_check';
import { ChainMiddlewareRunStatus, ChatChain } from '../chains/chain';
import { queryJoinedConversationRoom, getConversationRoomCount as getMaxConversationRoomId, getTemplateConversationRoom, createConversationRoom, queryPublicConversationRoom, getAllJoinedConversationRoom, switchConversationRoom } from '../chains/rooms';

const logger = createLogger("@dingyi222666/chathub/middlewares/resolve_room")

export function apply(ctx: Context, config: Config, chain: ChatChain) {
    chain.middleware("resolve_room", async (session, context) => {

        let joinRoom = await queryJoinedConversationRoom(ctx, session, context.options?.room_resolve?.name)


        if (joinRoom == null) {
            // 随机加入到一个你已经加入的房间？？？
            const joinedRooms = await getAllJoinedConversationRoom(ctx, session)

            if (joinedRooms.length > 0) {
                joinRoom = joinedRooms[Math.floor(Math.random() * joinedRooms.length)]
                await switchConversationRoom(ctx, session, joinRoom.roomId)
                await context.send(`你已经加入了多个房间，但你未在当前环境里设置默认房间，已为你自动切换到房间 ${joinRoom.roomName}。`)
            }
        }


        if (joinRoom == null && !session.isDirect) {
            joinRoom = await queryPublicConversationRoom(ctx, session)
            if (joinRoom != null) {
                await context.send(`你未加入任何房间，已为你自动加入到群内的公共房间房间 ${joinRoom.roomName}。`)
            }
        }


        if (joinRoom == null && (context.command?.length ?? 0) < 1) {
            // 尝试基于模板房间创建房间

            const templateRoom = await getTemplateConversationRoom(ctx)

            if (templateRoom == null) {
                // 没有就算了。后面需要房间的中间件直接报错就完事。
                return ChainMiddlewareRunStatus.SKIPPED
            }

            const cloneRoom = structuredClone(templateRoom)

            cloneRoom.conversationId = uuidv4()

            // 如果是群聊的公共房间，那么就房主直接设置为群主，否则就是私聊
            cloneRoom.roomMasterId = session.userId

            cloneRoom.visibility = session.isDirect ? 'private' : 'public'

            cloneRoom.roomId = ((await getMaxConversationRoomId(ctx)) + 1)

            cloneRoom.roomName = session.isDirect ? `${session.username} 的私有房间` : `${session.guildName ?? session.username ?? session.guildId.toString()} 的公共房间`

            await createConversationRoom(ctx, session, cloneRoom)

            await context.send(`你未加入任何房间，已为你自动创建房间 ${cloneRoom.roomName}。`)

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
    }

    interface ChainMiddlewareName {
        "resolve_room": never
    }
}