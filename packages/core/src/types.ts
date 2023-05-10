import { SystemPrompts } from '@dingyi222666/chathub-llm-core/lib/chain/base';
import { h } from 'koishi';

export interface ConversationInfo {
    conversationId: string;
    senderId: string;
    // dynamic read system prompt.
    systemPrompts: string;
    chatMode:  "search-chat" | "chat" | "search" | "tools";
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
