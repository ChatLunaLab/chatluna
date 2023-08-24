import { SystemPrompts } from './llm-core/chain/base';
import { h } from 'koishi';


export interface ConversationRoom {
    visibility: "public" | "private" 
    roomMasterId: string;
    roomName: string;
    roomId: number;
    conversationId?: string;
    preset: string;
    model: string;
    chatMode: string;
    password?: string

    // allowGroups?: string[]
    // allowUsers?: string[]
}

export interface ConversationRoomMemberInfo {
    userId: string
    roomId: number;
    mute?: boolean
    roomPermission: "owner" | "admin" | "member"
}

export interface ConversationRoomGroupInfo {
    groupId: string
    roomId: number
    roomVisibility: "public" | "private"
}

export interface ConversationRoomUserInfo {
    groupId?: string
    defaultRoomId: number
    userId: string
}


/**
 * 渲染参数
 */
export interface RenderOptions {
    // 如果type为voice，那么这个值不可为空
    voice?: {
        speakerId?: number
    }
    split?: boolean
    type: RenderType
}


export interface Message {

    content: string

    name?: string

    /**
     * 附加消息回复
     */
    additionalReplyMessages?: Message[]
}


export interface RenderMessage {
    element: h | h[]
}

export type RenderType = "raw" | "voice" | "text" | "image" | "mixed"
