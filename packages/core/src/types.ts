import { MessageContent } from '@langchain/core/messages'
import { h, Session } from 'koishi'

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
    session?: Session
}

export interface Message {
    content: MessageContent

    conversationId?: string

    name?: string

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
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
