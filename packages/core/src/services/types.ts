import { Session } from 'koishi'
import { ConversationRoom, ConversationRoomGroupInfo, ConversationRoomMemberInfo, ConversationRoomUserInfo } from '../types'
import { ChatHubService } from './chat'

export interface ChatEvents {
    'llm-new-message': (message: string) => Promise<void>
    'llm-queue-waiting': (size:number) => Promise<void>
}


declare module 'koishi' {
    export interface Context {
        chathub: ChatHubService
    }
}

declare module 'koishi' {
    interface Tables {
        chathub_room: ConversationRoom
        chathub_room_member: ConversationRoomMemberInfo
        chathub_room_group_member: ConversationRoomGroupInfo
        chathub_user: ConversationRoomUserInfo
    }
    interface Events {
        'chathub/before-check-sender'(session: Session): Promise<boolean>
    }

}