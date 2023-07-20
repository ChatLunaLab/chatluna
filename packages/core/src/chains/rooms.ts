import { Context, Session } from 'koishi';
import { ConversationRoom } from '../types';

async function getConversationRoom(ctx: Context, session: Session) {
    const userRoomInfoList = await ctx.database.get('chathub_user', {
        userId: session.userId,
        groupId: session.isDirect ? undefined : session.guildId
    })

    if (userRoomInfoList.length > 1) {
        throw new Error("用户存在多个房间，这是不可能的！")
    } else if (userRoomInfoList.length === 0) {
        return null
    }

    const userRoomInfo = userRoomInfoList[0]


    const conversationRoomList = await ctx.database.get('chathub_room', {
        roomId: userRoomInfo.defaultRoomId
    })

    if (conversationRoomList.length > 1) {
        throw new Error("房间 ID 存在多个，这是不可能的！")
    } else if (conversationRoomList.length === 0) {
        return null
    }

    return conversationRoomList[0] as ConversationRoom

}