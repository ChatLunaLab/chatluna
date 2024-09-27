import { Context } from 'koishi'
import { Config } from '../config'
import { ChainMiddlewareRunStatus, ChatChain } from '../chains/chain'

import {
    getAllJoinedConversationRoom,
    getConversationRoomUser,
    switchConversationRoom
} from '../chains/rooms'

export function apply(ctx: Context, config: Config, chain: ChatChain) {
    chain
        .middleware('check_room', async (session, context) => {
            let room = context.options.room

            const rooms = await getAllJoinedConversationRoom(ctx, session)

            // 检查当前用户是否在当前房间
            if (room == null && rooms.length > 0) {
                room = rooms[Math.floor(Math.random() * rooms.length)]
                await switchConversationRoom(ctx, session, room.roomId)
                await context.send(
                    session.text('chatluna.room.random_switch', [room.roomName])
                )
            } else if (room == null && rooms.length === 0) {
                context.message = session.text('chatluna.room.not_joined')
                return ChainMiddlewareRunStatus.STOP
            } else if (
                !rooms.some(
                    (searchRoom) =>
                        searchRoom.roomName === room.roomName ||
                        searchRoom.roomId === room.roomId
                )
            ) {
                context.message = session.text('chatluna.room.not_in_room', [
                    room.roomName
                ])
                return ChainMiddlewareRunStatus.STOP
            }

            // 检查是否被禁言

            const user = await getConversationRoomUser(ctx, session, room)

            if (user.mute === true) {
                context.message = session.text('chatluna.room.muted', [
                    room.roomName
                ])
                return ChainMiddlewareRunStatus.STOP
            }

            context.options.room = room

            return ChainMiddlewareRunStatus.CONTINUE
        })
        .before('request_model')
}

declare module '../chains/chain' {
    interface ChainMiddlewareName {
        check_room: never
    }
}
