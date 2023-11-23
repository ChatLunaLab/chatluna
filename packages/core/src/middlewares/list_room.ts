import { Context } from 'koishi'
import { Config } from '../config'
import { ChainMiddlewareRunStatus, ChatChain } from '../chains/chain'
import {
    checkConversationRoomAvailability,
    getAllJoinedConversationRoom
} from '../chains/rooms'
import { ConversationRoom } from '../types'
import { Pagination } from '../utils/pagination'

export function apply(ctx: Context, config: Config, chain: ChatChain) {
    const pagination = new Pagination<ConversationRoom>({
        formatItem: (value) => formatRoomInfo(ctx, value),
        formatString: {
            top: '以下是查询到你加入的房间列表：\n',
            bottom: '你可以使用 chatluna.room.switch <name/id> 来切换当前环境里你的默认房间。'
        }
    })

    chain
        .middleware('list_room', async (session, context) => {
            const {
                command,
                options: { page, limit }
            } = context

            if (command !== 'list_room') return ChainMiddlewareRunStatus.SKIPPED

            const rooms = await getAllJoinedConversationRoom(ctx, session)

            const key = session.isDirect
                ? session.userId
                : session.guildId + '-' + session.userId

            await pagination.push(rooms, key)

            context.message = await pagination.getFormattedPage(
                page,
                limit,
                key
            )

            return ChainMiddlewareRunStatus.STOP
        })
        .after('lifecycle-handle_command')
}

export async function formatRoomInfo(ctx: Context, room: ConversationRoom) {
    const buffer = []

    buffer.push(`房间名: ${room.roomName}`)
    buffer.push(`房间ID: ${room.roomId}`)
    buffer.push(`房间预设: ${room.preset}`)
    buffer.push(`房间模型: ${room.model}`)
    buffer.push(`房间可见性: ${room.visibility}`)
    buffer.push(`房间聊天模式: ${room.chatMode}`)
    buffer.push(`房间创建者ID: ${room.roomMasterId}`)
    buffer.push(
        `房间可用性：${await checkConversationRoomAvailability(ctx, room)}`
    )

    return buffer.join('\n')
}

declare module '../chains/chain' {
    interface ChainMiddlewareName {
        list_room: never
    }
}
