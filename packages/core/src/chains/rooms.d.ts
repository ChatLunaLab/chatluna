import { Context, Session } from 'koishi'
import { Config } from '../config'
import { ConversationRoom, ConversationRoomGroupInfo } from '../types'
export declare function queryJoinedConversationRoom(
    ctx: Context,
    session: Session,
    name?: string
): Promise<ConversationRoom>
export declare function queryPublicConversationRooms(
    ctx: Context,
    session: Session
): Promise<ConversationRoomGroupInfo[]>
export declare function queryPublicConversationRoom(
    ctx: Context,
    session: Session
): Promise<ConversationRoom>
export declare function checkConversationRoomAvailability(
    ctx: Context,
    room: ConversationRoom
): Promise<boolean>
export declare function fixConversationRoomAvailability(
    ctx: Context,
    config: Config,
    room: ConversationRoom
): Promise<boolean>
export declare function getTemplateConversationRoom(
    ctx: Context,
    config: Config
): Promise<ConversationRoom>
export declare function getConversationRoomCount(ctx: Context): Promise<number>
export declare function transferConversationRoom(
    ctx: Context,
    session: Session,
    room: ConversationRoom,
    userId: string
): Promise<void>
export declare function switchConversationRoom(
    ctx: Context,
    session: Session,
    id: string | number
): Promise<ConversationRoom>
export declare function getAllJoinedConversationRoom(
    ctx: Context,
    session: Session,
    queryAll?: boolean
): Promise<ConversationRoom[]>
export declare function leaveConversationRoom(
    ctx: Context,
    session: Session,
    room: ConversationRoom
): Promise<void>
export declare function queryConversationRoom(
    ctx: Context,
    session: Session,
    name: string | number
): Promise<ConversationRoom>
export declare function resolveConversationRoom(
    ctx: Context,
    roomId: number
): Promise<ConversationRoom>
export declare function deleteConversationRoom(
    ctx: Context,
    room: ConversationRoom
): Promise<void>
export declare function deleteConversationRoomByRoomId(
    ctx: Context,
    roomId: number
): Promise<void>
export declare function joinConversationRoom(
    ctx: Context,
    session: Session,
    roomId: number | ConversationRoom,
    isDirect?: boolean,
    userId?: string
): Promise<void>
export declare function getConversationRoomUser(
    ctx: Context,
    session: Session,
    roomId: number | ConversationRoom,
    userId?: string
): Promise<import('..').ConversationRoomMemberInfo>
export declare function setUserPermission(
    ctx: Context,
    session: Session,
    roomId: number | ConversationRoom,
    permission: 'member' | 'admin',
    userId?: string
): Promise<void>
export declare function addConversationRoomToGroup(
    ctx: Context,
    session: Session,
    roomId: number | ConversationRoom,
    groupId?: string
): Promise<void>
export declare function muteUserFromConversationRoom(
    ctx: Context,
    session: Session,
    roomId: number | ConversationRoom,
    userId: string
): Promise<void>
export declare function kickUserFromConversationRoom(
    ctx: Context,
    session: Session,
    roomId: number | ConversationRoom,
    userId: string
): Promise<void>
export declare function checkAdmin(session: Session): Promise<boolean>
export declare function updateChatTime(
    ctx: Context,
    room: ConversationRoom
): Promise<void>
export declare function createConversationRoom(
    ctx: Context,
    session: Session,
    room: ConversationRoom
): Promise<void>
