import { $, Context, Session } from 'koishi';
import { ConversationRoom, ConversationRoomGroupInfo } from '../types';
import { randomInt } from 'crypto';
import { chunkArray } from '../llm-core/utils/chunk';
import { group } from 'console';

export async function queryJoinedConversationRoom(ctx: Context, session: Session, name?: string) {


    if (name != null) {
        const joinedRooms = await getAllJoinedConversationRoom(ctx, session)

        return joinedRooms.find(it => it.roomName === name || it.roomId === parseInt(name))
    }

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


    const room = await resolveConversationRoom(ctx, userRoomInfo.defaultRoomId)

    return room
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


    let roomId: number

    if (groupRoomInfoList.length < 1) {
        return null
    } else if (groupRoomInfoList.length == 1) {
        roomId = groupRoomInfoList[0].roomId
    } else {
        const groupRoomInfo = groupRoomInfoList[randomInt(groupRoomInfoList.length)]
        roomId = groupRoomInfo.roomId
    }

    const room = await resolveConversationRoom(ctx, roomId)

    await joinConversationRoom(ctx, session, room)
    return room
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
    const counts = await ctx.database.eval('chathub_room', row => $.max(row.roomId), {})

    return counts
}

export async function createTemplateConversationRoom(ctx: Context, room: ConversationRoom) {
    room.roomId = 0
    room.conversationId = undefined
    room.visibility = "template"
    await ctx.database.create('chathub_room', room)
}

export async function switchConversationRoom(ctx: Context, session: Session, id: string | number) {
    let joinedRoom = await getAllJoinedConversationRoom(ctx, session)

    let parsedId = typeof id === "number" ? id : parseInt(id)

    let room = joinedRoom.find(it => it.roomId == parsedId)

    if (room != null) {
        await ctx.database.upsert('chathub_user', [{
            userId: session.userId,
            defaultRoomId: room.roomId,
            groupId: session.isDirect ? undefined : session.guildId
        }])

        return room
    }

    joinedRoom = joinedRoom.filter(it => it.roomName != id)

    if (joinedRoom.length > 1) {
        throw new Error("切换房间失败！这个房间名字对应了多个房间哦")
    } else if (joinedRoom.length === 0) {
        throw new Error("切换房间失败！没有找到和这个名字或者 id 相关的房间。可能是没找到房间或者你没有加入该房间")
    } else {
        room = joinedRoom[0]
    }

    await ctx.database.upsert('chathub_user', [{
        userId: session.userId,
        defaultRoomId: room.roomId,
        groupId: session.isDirect ? undefined : session.guildId
    }])

    return room
}

export async function getAllJoinedConversationRoom(ctx: Context, session: Session, queryAll: boolean = false) {
    // 这里分片进行 chunk 然后用 in 查询，这么做的好处是可以减少很多的查询次数
    const conversationRoomIdList = chunkArray(await ctx.database.get('chathub_room_member', {
        userId: session.userId
    }), 35)

    const rooms: ConversationRoom[] = []

    for (const conversationRoomIdListChunk of conversationRoomIdList) {
        const roomIds = conversationRoomIdListChunk.map(it => it.roomId)
        const roomList = await ctx.database.get('chathub_room', {
            roomId: {
                $in: roomIds
            }
        })


        let memberList: ConversationRoomGroupInfo[] = []

        if (queryAll == false) {
            memberList = session.isDirect ? await ctx.database.get('chathub_room_group_meber', {
                roomId: {
                    $in: roomIds
                }
            }) : await ctx.database.get('chathub_room_group_meber', {
                roomId: {
                    $in: roomIds
                },
                groupId: session.guildId
            })
        }

        for (const room of roomList) {
            const memberOfTheRoom = memberList.find(it => it.roomId == room.roomId)

            if ((session.isDirect === true && memberOfTheRoom === null) || (memberOfTheRoom != null && session.isDirect === false) || queryAll === true) {
                rooms.push(room)
            }
        }
    }


    return rooms

}

export async function leaveConversationRoom(ctx: Context, session: Session, room: ConversationRoom) {

    await ctx.database.remove('chathub_room_member', {
        userId: session.userId,
        roomId: room.roomId
    })

    await ctx.database.remove('chathub_user', {
        userId: session.userId,
        defaultRoomId: room.roomId
    })

}

export async function queryConversationRoom(ctx: Context, session: Session, name: string) {

    let roomId = parseInt(name)

    let roomList = Number.isNaN(roomId) ? await ctx.database.get('chathub_room', {
        roomName: name
    }) : await ctx.database.get('chathub_room', {
        roomId: parseInt(name)
    })

    if (roomList.length === 1) {
        return roomList[0] as ConversationRoom
    } else if (roomList.length > 1) {

        // 在限定搜索到群里一次。

        if (session.isDirect === false && !Number.isNaN(roomId)) {
            const groupRoomList = await ctx.database.get('chathub_room_group_meber', {
                groupId: session.guildId,
                roomId: {
                    $in: roomList.map(it => it.roomId)
                }
            })

            if (groupRoomList.length === 1) {
                return roomList.find(it => it.roomId === groupRoomList[0].roomId)
            } else if (groupRoomList.length > 1) {
                throw new Error("输入的名字找到了多个房间，这是不可能的！")
            }
        } else {

            throw new Error("输入的名字找到了多个房间，这是不可能的！")
        }
    } else if (roomList.length === 0) {
        return null
    }
}

export async function resolveConversationRoom(ctx: Context, roomId: number) {
    const roomList = await ctx.database.get('chathub_room', {
        roomId
    })

    if (roomList.length > 1) {
        throw new Error("房间 ID 存在多个，这是不可能的！")
    } else if (roomList.length === 0) {
        return null
    }

    return roomList[0] as ConversationRoom
}


export async function deleteConversationRoom(ctx: Context, session: Session, room: ConversationRoom) {
    const chatBridger = ctx.chathub.queryBridger(room)
    await chatBridger.clearChatHistory(room)

    await ctx.database.remove('chathub_room', {
        roomId: room.roomId
    })

    await ctx.database.remove('chathub_room_member', {
        roomId: room.roomId
    })

    await ctx.database.remove('chathub_room_group_meber', {
        roomId: room.roomId
    })

    await ctx.database.remove('chathub_user', {
        defaultRoomId: room.roomId
    })
}

export async function joinConversationRoom(ctx: Context, session: Session, roomId: number | ConversationRoom, isDirect: boolean = session.isDirect, userId: string = session.userId) {
    // 接下来检查房间的权限和当前所处的环境

    const room = typeof roomId === "number" ?
        await resolveConversationRoom(ctx, roomId) : roomId


    await ctx.database.upsert('chathub_user', [{
        userId,
        defaultRoomId: room.roomId,
        groupId: session.isDirect ? undefined : session.guildId
    }])


    if (isDirect === false) {
        // 如果是群聊，那么就需要检查群聊的权限

        const groupMemberList = await ctx.database.get('chathub_room_group_meber', {
            groupId: session.guildId,
            roomId: room.roomId
        })

        if (groupMemberList.length === 0) {
            await ctx.database.create('chathub_room_group_meber', {
                groupId: session.guildId,
                roomId: room.roomId,
                roomVisibility: room.visibility
            })
        }
    }

    const memberList = await ctx.database.get('chathub_room_member', {
        userId,
        roomId: room.roomId
    })

    if (memberList.length === 0) {
        await ctx.database.create('chathub_room_member', {
            userId,
            roomId: room.roomId,
            roomPermission: userId === room.roomMasterId ? "owner" : "member"
        })
    }
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


    await joinConversationRoom(ctx, session, room)
}