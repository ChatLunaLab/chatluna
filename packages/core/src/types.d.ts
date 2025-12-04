import { MessageContent } from '@langchain/core/messages'
import { h, Session } from 'koishi'
export interface ConversationRoom {
    visibility: 'public' | 'private' | 'template_clone'
    roomMasterId: string
    roomName: string
    roomId: number
    conversationId?: string
    preset: string
    model: string
    chatMode: string
    password?: string
    autoUpdate?: boolean
    updatedTime: Date
}
export interface ConversationRoomMemberInfo {
    userId: string
    roomId: number
    mute?: boolean
    roomPermission: 'owner' | 'admin' | 'member'
}
export interface ConversationRoomGroupInfo {
    groupId: string
    roomId: number
    roomVisibility: 'public' | 'private' | 'template_clone'
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
    voice?: {
        speakerId?: number
    }
    split?: boolean
    type: RenderType
    session?: Session
}
export interface Message {
    content: MessageContent
    conversationId?: string
    name?: string
    additional_kwargs?: Record<string, any>
    /**
     * 附加消息回复
     */
    additionalReplyMessages?: Message[]
}
export interface RenderMessage {
    element: h | h[]
}
export type RenderType = 'raw' | 'voice' | 'text' | 'image' | 'mixed'
