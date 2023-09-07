import { Context, h } from 'koishi';
import { Config } from '../config';
import { ChainMiddlewareRunStatus, ChatChain } from '../chains/chain';
import { createLogger } from '../utils/logger';
import { getAllJoinedConversationRoom } from '../chains/rooms';
import { ConversationRoom } from '../types';
import { CacheMap } from '../utils/queue';


const logger = createLogger()

export function apply(ctx: Context, config: Config, chain: ChatChain) {

    const cacheMap = new CacheMap<ConversationRoom[]>()

    chain.middleware("list_room", async (session, context) => {

        let { command, options: { page, limit } } = context

        if (command !== "list_room") return ChainMiddlewareRunStatus.SKIPPED

        let rooms = await getAllJoinedConversationRoom(ctx, session)

        const buffer = ["以下是查询到你加入的房间列表：\n"]

        const key = session.isDirect ? session.userId : session.guildId + "-" + session.userId

        await cacheMap.set(
            key, rooms, (a, b) => {
                if (a.length !== b.length) return false
                const sortedA = a.sort()
                const sortedB = b.sort()

                return sortedA.every((value, index) => value.roomId === sortedB[index].roomId)
            })

        rooms = await cacheMap.get(key)

        const rangeRooms = rooms.slice((page - 1) * limit, Math.min(rooms.length, page * limit))

        for (const room of rangeRooms) {
            buffer.push(formatRoomInfo(room))
            buffer.push('\n')
        }

        buffer.push("你可以使用 chathub.room.switch <name/id> 来切换到你加入的房间。")

        buffer.push(`\n当前为第 ${page} / ${Math.ceil(rooms.length / limit)} 页`)

        context.message = buffer.join("\n")


        return ChainMiddlewareRunStatus.STOP
    }).after("lifecycle-handle_command")
}


export function formatRoomInfo(room: ConversationRoom) {
    const buffer = []

    buffer.push(`房间名: ${room.roomName}`)
    buffer.push(`房间ID: ${room.roomId}`)
    buffer.push(`房间预设: ${room.preset}`)
    buffer.push(`房间模型: ${room.model}`)
    buffer.push(`房间可见性: ${room.visibility}`)
    buffer.push(`房间聊天模式: ${room.chatMode}`)
    buffer.push(`房间创建者ID: ${room.roomMasterId}`)

    return buffer.join("\n")
}


declare module '../chains/chain' {
    interface ChainMiddlewareName {
        "list_room": never
    }

}