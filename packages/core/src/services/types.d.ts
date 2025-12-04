import { Session } from 'koishi'
import {
    ConversationRoom,
    ConversationRoomGroupInfo,
    ConversationRoomMemberInfo,
    ConversationRoomUserInfo
} from '../types'
import { ChatLunaService } from './chat'
import { BaseMessageChunk } from '@langchain/core/messages'
export interface ChatEvents {
    'llm-new-token'?: (token: string) => Promise<void>
    'llm-queue-waiting'?: (size: number) => Promise<void>
    'llm-used-token-count'?: (token: number) => Promise<void>
    'llm-call-tool'?: (tool: string, args: any, log: string) => Promise<void>
    'llm-new-chunk'?: (chunk: BaseMessageChunk) => Promise<void>
}
declare module 'koishi' {
    interface Context {
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
    interface RenderConfigurable {
        session?: Session
    }
}
export * from '@chatluna/shared-prompt-renderer'
