import { Context } from 'koishi';
import { Config } from '../config';
import { ChainMiddlewareRunStatus, ChatChain } from '../chains/chain';
import { createLogger } from '../utils/logger';
import { getAllJoinedConversationRoom, getConversationRoomUser, switchConversationRoom } from '../chains/rooms';
const logger = createLogger()


export function apply(ctx: Context, config: Config, chain: ChatChain) {
    chain.middleware("check_room", async (session, context) => {

        let room = context.options.room

        const rooms = await getAllJoinedConversationRoom(ctx, session)

        // 检查当前用户是否在当前房间
        if (room == null && rooms.length > 0) {
            room = rooms[Math.floor(Math.random() * rooms.length)]
            await switchConversationRoom(ctx, session, room.roomId)
            await context.send(`检测到你没有指定房间，已为你随机切换到房间 ${room.roomName}`)
        } else if (room == null && rooms.length === 0) {
            context.message = "你还没有加入任何房间，请先加入房间。"
            return ChainMiddlewareRunStatus.STOP
        } else if (!rooms.some(searchRoom => searchRoom.roomName === room.roomName || searchRoom.roomId === room.roomId)) {
            context.message = `你没有加入此房间，请先加入房间 ${room.roomName}。`
            return ChainMiddlewareRunStatus.STOP
        }


        //检查是否被禁言

        const user = await getConversationRoomUser(ctx, session, room)

        if (user.mute === true) {
            context.message = `你已被禁言，无法在房间 ${room.roomName} 发言。`
            return ChainMiddlewareRunStatus.STOP
        }

        context.options.room = room

        return ChainMiddlewareRunStatus.CONTINUE
    }).before('request_model')
}

declare module '../chains/chain' {
    interface ChainMiddlewareName {
        "check_room": never
    }
}