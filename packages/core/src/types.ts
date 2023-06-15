import { SystemPrompts } from './llm-core/chain/base';
import { h } from 'koishi';

export interface ConversationInfo {
    conversationId: string;
    senderId: string;
    chatMode: "plugin" | "chat" | "browsing"
    model?: string;
    // dynamic read system prompt.
    systemPrompts?: string;
    preset?: string;
}

export interface SenderInfo {
    senderId: string;
    userId: string;
    senderName: string
    preset?: string;
    model?: string;
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
    text: string

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
