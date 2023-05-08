import { h } from 'koishi';

export interface ConversationId {
    id: string;

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


export interface SimpleMessage {
    text: string

    /**
     * 附加消息回复
     */
    additionalReplyMessages?: SimpleMessage[]
}


export interface RenderMessage {
    element: h | h[]
}

export type RenderType = "raw" | "voice" | "text" | "image" | "mixed"
