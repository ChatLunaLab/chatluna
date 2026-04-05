import { Awaitable, Session } from 'koishi'
import {
    ACLRecord,
    ArchiveRecord,
    BindingRecord,
    ConstraintPermission,
    ConstraintRecord,
    ConversationRecord,
    MessageRecord,
    MetaRecord,
    ResolveConversationContextOptions
} from './conversation_types'
import { ChatLunaService } from './chat'
import {
    AIMessage,
    BaseMessageChunk,
    MessageContent,
    MessageType
} from '@langchain/core/messages'
import {
    AgentAction,
    SubagentContext,
    ToolMask
} from 'koishi-plugin-chatluna/llm-core/agent'
import type { ChatInterface } from '../llm-core/chat/app'
import { MessageQueue } from '../llm-core/agent/types'

export interface LegacyConversationRecord {
    id: string
    latestId?: string | null
    additional_kwargs?: string | null
    updatedAt?: Date | null
}

export interface LegacyMessageRecord {
    text?: MessageContent | null
    content?: ArrayBuffer | null
    id: string
    rawId?: string | null
    role: MessageType
    conversation: string
    name?: string | null
    tool_call_id?: string | null
    tool_calls?: AIMessage['tool_calls']
    additional_kwargs?: string | null
    additional_kwargs_binary?: ArrayBuffer | null
    parent?: string | null
}

export interface LegacyRoomRecord {
    visibility: 'public' | 'private' | 'template_clone'
    roomMasterId: string
    roomName: string
    roomId: number
    conversationId?: string | null
    preset: string
    model: string
    chatMode: string
    password?: string | null
    autoUpdate?: boolean | null
    updatedTime: Date
}

export interface LegacyRoomMemberRecord {
    userId: string
    roomId: number
    mute?: boolean | null
    roomPermission: 'owner' | 'admin' | 'member'
}

export interface LegacyRoomGroupRecord {
    groupId: string
    roomId: number
    roomVisibility: 'public' | 'private' | 'template_clone'
}

export interface LegacyUserRecord {
    groupId?: string | null
    defaultRoomId: number
    userId: string
}

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

export interface RuntimeConversationEntry {
    conversation: ConversationRecord
    chatInterface: ChatInterface
}

export interface ActiveRequest {
    requestId: string
    conversationId: string
    sessionId?: string
    abortController: AbortController
    chatMode: string
    messageQueue: MessageQueue
    roundDecisionResolvers: ((canContinue: boolean) => void)[]
    lastDecision?: boolean
}

export interface ListConversationsOptions extends ResolveConversationContextOptions {
    includeArchived?: boolean
    allPresetLanes?: boolean
}

export interface ResolveTargetConversationOptions extends ResolveConversationContextOptions {
    targetConversation?: string
    includeArchived?: boolean
    permission?: ConstraintPermission
    allPresetLanes?: boolean
}

export interface SerializedMessageRecord extends Omit<
    MessageRecord,
    'content' | 'additional_kwargs_binary' | 'createdAt'
> {
    content?: string | null
    additional_kwargs_binary?: string | null
    createdAt?: string | null
}

export interface ConversationArchivePayload {
    formatVersion: number
    exportedAt: string
    conversation: Omit<
        ConversationRecord,
        'createdAt' | 'updatedAt' | 'lastChatAt' | 'archivedAt'
    > & {
        createdAt: string
        updatedAt: string
        lastChatAt?: string | null
        archivedAt?: string | null
    }
    messages: SerializedMessageRecord[]
}

export interface ArchiveManifest {
    format: 'chatluna-archive'
    formatVersion: number
    conversationId: string
    messageCount: number
    checksum?: string | null
    size: number
    createdAt: string
}

declare module 'koishi' {
    export interface Context {
        chatluna: ChatLunaService
    }

    interface Events {
        'chatluna/before-check-sender'(session: Session): Promise<boolean>
    }

    interface Tables {
        chathub_conversation: LegacyConversationRecord
        chathub_message: LegacyMessageRecord
        chathub_room: LegacyRoomRecord
        chathub_room_member: LegacyRoomMemberRecord
        chathub_room_group_member: LegacyRoomGroupRecord
        chathub_user: LegacyUserRecord
        chatluna_conversation: ConversationRecord
        chatluna_message: MessageRecord
        chatluna_binding: BindingRecord
        chatluna_constraint: ConstraintRecord
        chatluna_archive: ArchiveRecord
        chatluna_acl: ACLRecord
        chatluna_meta: MetaRecord
    }
}

declare module '@chatluna/shared-prompt-renderer' {
    export interface RenderConfigurable {
        session?: Session
        conversationId?: string
        subagentContext?: SubagentContext
        toolMask?: ToolMask
        source?: string
    }
}

export * from '@chatluna/shared-prompt-renderer'

export interface ToolMaskArg {
    session: Session
    conversation?: ConversationRecord
    bindingKey?: string
}

export type ToolMaskResolver = (
    arg: ToolMaskArg
) => Awaitable<ToolMask | undefined>
