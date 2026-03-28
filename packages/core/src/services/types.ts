import { Awaitable, Session } from 'koishi'
import {
    ConversationRoom,
    ConversationRoomGroupInfo,
    ConversationRoomMemberInfo,
    ConversationRoomUserInfo
} from '../types'
import { ChatLunaService } from './chat'
import { BaseMessageChunk } from '@langchain/core/messages'
import {
    AgentAction,
    SubagentContext,
    ToolMask
} from 'koishi-plugin-chatluna/llm-core/agent'

export interface ChatEvents {
    'llm-new-token'?: (token: string) => Promise<void>
    'llm-queue-waiting'?: (size: number) => Promise<void>
    'llm-used-token-count'?: (token: number) => Promise<void>

    'llm-call-tool'?: (
        tool: string,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        args: any,
        content: AgentAction['content'],
        log: string
    ) => Promise<void>
    'llm-new-chunk'?: (chunk: BaseMessageChunk) => Promise<void>
}

declare module 'koishi' {
    export interface Context {
        chatluna: ChatLunaService
    }

    interface Events {
        'chatluna/before-check-sender'(session: Session): Promise<boolean>
    }

    interface Tables {
        chathub_room: ConversationRoom
        chathub_room_member: ConversationRoomMemberInfo
        chathub_room_group_member: ConversationRoomGroupInfo
        chathub_user: ConversationRoomUserInfo
    }
}

declare module '@chatluna/shared-prompt-renderer' {
    export interface RenderConfigurable {
        session?: Session
        conversationId?: string
        subagentContext?: SubagentContext
    }
}

export * from '@chatluna/shared-prompt-renderer'

export interface ToolMaskArg {
    session: Session
    room?: ConversationRoom
    source?: 'chatluna' | 'character'
}

export type ToolMaskResolver = (
    arg: ToolMaskArg
) => Awaitable<ToolMask | undefined>
