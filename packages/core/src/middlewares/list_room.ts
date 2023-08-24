import { Context, h } from 'koishi';
import { Config } from '../config';
import { ChainMiddlewareRunStatus, ChatChain } from '../chains/chain';
import { createLogger } from '../llm-core/utils/logger';
import { getAllJoinedConversationRoom } from '../chains/rooms';
import { ConversationRoom } from '../types';


const logger = createLogger("@dingyi222666/chathub/middlewares/list_room")

export function apply(ctx: Context, config: Config, chain: ChatChain) {
    chain.middleware("list_room", async (session, context) => {

        const { command } = context

        if (command !== "listRoom") return ChainMiddlewareRunStatus.SKIPPED

        const rooms = await getAllJoinedConversationRoom(ctx, session)

        const buffer = [["以下是查询到你加入的房间列表\n"]]
        let currentBuffer = buffer[0]

        for (let i = 0; i < rooms.length; i++) {
            const conversationInfo = rooms[i]

            currentBuffer.push(formatRoomInfo(conversationInfo))
            currentBuffer.push("\n")

            if (i % 5 === 0 && i !== 0) {
                currentBuffer = []
                buffer.push(currentBuffer)
            }
        }

        buffer.push(["\n你可以使用 chathub.room.switch <name/id> 来切换到你加入的房间。"])

        context.message = buffer.map(buffers => buffers.join("\n")).map(x => [h.text(x)])


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