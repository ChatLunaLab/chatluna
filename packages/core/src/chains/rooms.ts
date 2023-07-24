import { $, Context, Session } from 'koishi';
import { ConversationRoom, ConversationRoomGroupInfo } from '../types';
import { randomInt } from 'crypto';
import { chunkArray } from '../llm-core/utils/chunk';

export async function getDefaultConversationRoom(ctx: Context, session: Session) {
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

export async function queryPublicConversationRoom(ctx: Context, session: Session) {

    // 如果是私聊，直接返回 null

    if (session.isDirect) {
        return null
    }

    // 如果是群聊，那么就查询群聊的公共房间

    const groupRoomInfoList = await ctx.database.get('chathub_room_group_meber', {
        groupId: session.guildId,
        roomVisibility: "public"
    })


    let roomId: string

    if (groupRoomInfoList.length < 1) {
        return null
    } else if (groupRoomInfoList.length == 1) {
        roomId = groupRoomInfoList[0].groupId
    } else {
        const groupRoomInfo = groupRoomInfoList[randomInt(groupRoomInfoList.length)]
        roomId = groupRoomInfo.groupId
    }

    const groupRoomList = await ctx.database.get('chathub_room', {
        roomId
    })

    if (groupRoomList.length > 1) {
        throw new Error("房间 ID 存在多个，这是不可能的！")
    } else if (groupRoomList.length === 0) {
        return null
    } else {
        return groupRoomList[0] as ConversationRoom
    }
}

export async function getTemplateConversationRoom(ctx: Context) {
    const templateRooms = await ctx.database.get('chathub_room', {
        visibility: "template"
    })


    if (templateRooms.length > 1) {
        throw new Error("存在多个模板房间，这是不可能的！")
    } else if (templateRooms.length === 0) {
        return null
    }

    return templateRooms[0] as ConversationRoom
}

export async function getConversationRoomCount(ctx: Context) {
    const counts = await ctx.database.eval('chathub_room', row => $.count(row.roomId), {})

    return counts
}

export async function createTemplateConversationRoom(ctx: Context, room: ConversationRoom) {
    room.roomId = "template"
    room.conversationId = undefined
    room.visibility = "template"
    await ctx.database.create('chathub_room', room)
}

export async function getAllJoinedConversationRoom(ctx: Context, session: Session) {
    // 这里分片进行 chunk 然后用 in 查询，这么做的好处是可以减少很多的查询次数
    const conversationRoomIdList = chunkArray(await ctx.database.get('chathub_room_member', {
        userId: session.userId
    }), 40)

    console.log(JSON.stringify(conversationRoomIdList))

    const rooms: ConversationRoom[] = []

    for (const conversationRoomIdListChunk of conversationRoomIdList) {
        const roomIds = conversationRoomIdListChunk.map(it => it.roomId)
        const roomList = await ctx.database.get('chathub_room', {
            roomId: {
                $in: roomIds
            }
        })


        const memberList = session.isDirect ? [] : await ctx.database.get('chathub_room_group_meber', {
            roomId: {
                $in: roomIds
            },
            groupId: session.guildId
        })

        for (const room of roomList) {
            const memberOfTheRoom = memberList.find(it => it.roomId == room.roomId)

            if (session.isDirect === true || (memberOfTheRoom != null && session.isDirect === false)) {
                rooms.push(room)
            }
        }
    }


    console.log(JSON.stringify(rooms))

    return rooms

}

export async function createConversationRoom(ctx: Context, session: Session, room: ConversationRoom) {
    // 先向 room 里面插入表

    await ctx.database.create('chathub_room', room)

    // 将创建者加入到房间成员里

    await ctx.database.create('chathub_room_member', {
        userId: session.userId,
        roomId: room.roomId,
        roomPermission: session.userId === room.roomMasterId ? "owner" : "member"
    })


    // 接下来检查房间的权限和当前所处的环境

    if (session.isDirect) {
        await ctx.database.upsert('chathub_user', [{
            userId: session.userId,
            defaultRoomId: room.roomId,
            groupId: undefined
        }])
    } else {
        await ctx.database.create('chathub_room_group_meber', {
            roomId: room.roomId,
            roomVisibility: room.visibility,
            groupId: session.guildId
        })

        await ctx.database.upsert('chathub_user', [{
            userId: session.userId,
            defaultRoomId: room.roomId,
            groupId: session.guildId
        }])
    }
}