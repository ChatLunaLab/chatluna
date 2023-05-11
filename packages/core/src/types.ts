import { SystemPrompts } from '@dingyi222666/chathub-llm-core/lib/chain/base';
import { h } from 'koishi';

export interface ConversationInfo {
    conversationId: string;
    senderId: string;
    chatMode: "search-chat" | "chat" | "search" | "tools";
    model?: string;
    // dynamic read system prompt.
    systemPrompts?: string;
}


export interface SenderInfo {
    /**
     * 发送者
     **/
    senderName: string;

    /*
        * 会话ID
    **/
    senderId: string;

    /*
    *用户ID
    **/
    userId: string;
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
