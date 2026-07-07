import { BaseMessageChunk, MessageContent } from '@langchain/core/messages'
import { h } from 'koishi'
import { Message } from '../types'

export type ReplyFrame =
    | {
          type: 'content'
          chunk: BaseMessageChunk
      }
    | {
          type: 'mark'
          name: 'thinking' | 'queue' | 'tool' | 'tool_result'
          content?: MessageContent
          instant?: boolean
      }
    | {
          type: 'done'
          message: Message
      }
    | {
          type: 'error'
          error: unknown
      }

export type RenderStreamMode = 'edit' | 'split' | 'buffer'

export interface RenderStreamPlan {
    mode: RenderStreamMode
    reason?: string
}

export interface RenderStreamSession {
    write(chunk: BaseMessageChunk): Promise<h[] | null> | h[] | null
    flush(): Promise<h[] | null> | h[] | null
}
