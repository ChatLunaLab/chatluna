import {
    AIMessage,
    MessageContent,
    MessageContentComplex,
    UsageMetadata
} from '@langchain/core/messages'
import { h, Session } from 'koishi'
import type { ToolMask } from './llm-core/agent'

export interface ChatInvocationRouting {
    platform: string
    selfId: string
    userId: string
    username?: string
    guildId?: string
    channelId?: string
    isDirect: boolean
}

export type ChatInvocationTarget =
    | { type: 'route' }
    | { type: 'task'; key: string }
    | { type: 'fresh' }
    | { type: 'existing'; id: string }
    | { type: 'ephemeral' }

export interface ChatInvocationInput {
    session?: Session
    routing?: ChatInvocationRouting
    message: string | MessageContentComplex[]
    messageName?: string
    model?: string
    preset?: string
    conversation: ChatInvocationTarget
    tools?: ToolMask
    variables?: Record<string, unknown>
    signal?: AbortSignal
    timeout?: number
    delivery: 'channel' | 'direct' | 'silent' | 'capture'
    source: { kind: string; id?: string; detail?: unknown }
    /** When false, do not persist conversation/message history. */
    persist?: boolean
}

export interface ChatInvocationResult {
    ok: boolean
    requestId: string
    model?: string
    conversation?: ConversationRecord
    reply?: Message
    usage?: UsageMetadata
    error?: { code: string; message: string }
}

export interface ChatInvocationContext {
    requestId: string
    delivery: ChatInvocationInput['delivery']
    source: ChatInvocationInput['source']
    variables: Record<string, unknown>
    toolMask?: ToolMask
    signal?: AbortSignal
    usage?: UsageMetadata
    persist?: boolean
}

export interface ResolveInvocationInput {
    target: ChatInvocationTarget
    requestId: string
    model?: string
    preset?: string
    persist: boolean
}

export type ActiveConversationResolution = ConversationResolution & {
    conversation: ConversationRecord
    /**
     * True when ConversationService creates a temporary record through
     * createEphemeral().
     */
    transient: boolean
}

export interface ChatLunaObservedMessage {
    id: string
    at: Date
    session: Session
    platform: string
    selfId: string
    userId: string
    username?: string
    guildId?: string
    channelId: string
    isDirect: boolean
    content: string
    elements: h[]
}

/**
 * 渲染参数
 */
export interface RenderOptions {
    // 如果type为voice，那么这个值不可为空
    voice?: {
        speakerId?: number
    }
    split?: SplitMode
    type: RenderType
    session?: Session
    prefix?: string
    postfix?: string
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

export type RenderType =
    | 'raw'
    | 'voice'
    | 'text'
    | 'image'
    | 'mixed'
    | 'mixed-voice'
    | 'koishi-element'
    | 'pure-text'

export type SplitMode = 'none' | 'punctuation' | 'paragraph'

export type ConversationStatus = 'active' | 'archived' | 'deleted' | 'broken'
export type RouteMode = 'personal' | 'shared' | 'custom'
export type ConstraintManageMode = 'anyone' | 'admin'
export type ConstraintPrincipalType = 'user' | 'guild'
export type ConstraintPermission = 'view' | 'manage'
export type ArchiveState = 'ready' | 'restoring' | 'broken'

export interface ConversationCompressionRecord {
    count?: number
    summary?: string
    compressedAt?: Date | string | null
    originalMessageCount?: number
    remainingMessageCount?: number
    tokenUsage?: number
    inputTokens?: number
    outputTokens?: number
    reducedTokens?: number
    reducedPercent?: number
    [key: string]: unknown
}

export interface ConversationRecord {
    id: string
    seq?: number
    bindingKey: string
    title: string
    model: string
    preset: string
    chatMode: string
    createdBy: string
    createdAt: Date
    updatedAt: Date
    lastChatAt?: Date | null
    status: ConversationStatus
    latestMessageId?: string | null
    additional_kwargs?: string | null
    compression?: string | null
    archivedAt?: Date | null
    archiveId?: string | null
    legacyRoomId?: number | null
    legacyMeta?: string | null
    autoTitle?: boolean | null
}

export interface ConversationListEntry {
    conversation: ConversationRecord
    displaySeq: number
}

export interface MessageRecord {
    id: string
    conversationId: string
    parentId?: string | null
    role: string
    text?: string | null
    content?: ArrayBuffer | null
    name?: string | null
    tool_call_id?: string | null
    tool_calls?: AIMessage['tool_calls']
    additional_kwargs_binary?: ArrayBuffer | null
    response_metadata_binary?: ArrayBuffer | null
    rawId?: string | null
    createdAt?: Date | null
}

export interface ChatLunaMessageMeta {
    recordId?: string
    createdAt?: string
    source?: 'user'
}

export interface BindingRecord {
    bindingKey: string
    activeConversationId?: string | null
    lastConversationId?: string | null
    updatedAt: Date
}

export interface ConstraintRecord {
    id?: number
    name: string
    enabled: boolean
    priority: number
    createdBy: string
    createdAt: Date
    updatedAt: Date
    platform?: string | null
    selfId?: string | null
    guildId?: string | null
    channelId?: string | null
    direct?: boolean | null
    users?: string | null
    excludeUsers?: string | null
    routeMode?: RouteMode | null
    routeKey?: string | null
    activePresetLane?: string | null
    defaultModel?: string | null
    defaultPreset?: string | null
    defaultChatMode?: string | null
    fixedModel?: string | null
    fixedPreset?: string | null
    fixedChatMode?: string | null
    lockConversation?: boolean | null
    allowNew?: boolean | null
    allowSwitch?: boolean | null
    allowArchive?: boolean | null
    allowExport?: boolean | null
    manageMode?: ConstraintManageMode | null
}

export interface ArchiveRecord {
    id: string
    conversationId: string
    path: string
    formatVersion: number
    messageCount: number
    checksum?: string | null
    size: number
    state: ArchiveState
    createdAt: Date
    restoredAt?: Date | null
}

export interface ACLRecord {
    conversationId: string
    principalType: ConstraintPrincipalType
    principalId: string
    permission: ConstraintPermission
}

export interface MetaRecord {
    key: string
    value?: string | null
    updatedAt: Date
}

export interface ResolvedConstraint {
    routeMode: RouteMode
    bindingKey: string
    baseKey: string
    constraints: ConstraintRecord[]
    activePresetLane?: string | null
    defaultModel?: string | null
    defaultPreset?: string | null
    defaultChatMode?: string | null
    fixedModel?: string | null
    fixedPreset?: string | null
    fixedChatMode?: string | null
    lockConversation: boolean
    allowNew: boolean
    allowSwitch: boolean
    allowArchive: boolean
    allowExport: boolean
    manageMode: ConstraintManageMode
}

export interface ResolvedConversationContext {
    bindingKey: string
    presetLane?: string
    conversation?: ConversationRecord | null
    binding?: BindingRecord | null
    effectiveModel?: string | null
    effectivePreset?: string | null
    effectiveChatMode?: string | null
    constraint: ResolvedConstraint
}

export type ConversationResolveMode = 'context' | 'active' | 'target'

export type ConstraintAction =
    | 'create'
    | 'switch'
    | 'rename'
    | 'delete'
    | 'archive'
    | 'restore'
    | 'export'
    | 'update'
    | 'compress'

export type ConstraintFixedField = 'model' | 'preset' | 'chatMode'

export interface ResolveConversationOptions {
    mode?: ConversationResolveMode
    presetLane?: string
    conversationId?: string
    bindingKey?: string
    useRoutePresetLane?: boolean
    targetConversation?: string
    includeArchived?: boolean
    permission?: ConstraintPermission
    allPresetLanes?: boolean
}

export interface ConversationResolution extends ResolvedConversationContext {
    mode: ConversationResolveMode
    conversationId: string | null
}

export function getBaseBindingKey(bindingKey: string) {
    const idx = bindingKey.indexOf(':preset:')
    return idx < 0 ? bindingKey : bindingKey.slice(0, idx)
}

export function getPresetLane(bindingKey: string) {
    const idx = bindingKey.indexOf(':preset:')
    return idx < 0 ? undefined : bindingKey.slice(idx + 8)
}

export function computeBaseBindingKey(
    session: Session,
    routeMode: RouteMode,
    routeKey?: string | null
): string {
    const platform = session.platform
    if (platform == null) {
        throw new Error('Session platform is missing.')
    }

    const selfId = session.selfId
    if (selfId == null) {
        throw new Error('Session selfId is missing.')
    }

    if (routeMode === 'custom') {
        if (routeKey == null || routeKey.length === 0) {
            throw new Error('Custom route key is missing.')
        }

        return `custom:${routeKey}`
    }

    if (routeMode === 'shared') {
        const guildId = session.guildId ?? session.channelId
        if (guildId == null) {
            throw new Error('Shared conversation route requires guildId.')
        }

        return `shared:${platform}:${selfId}:${guildId}`
    }

    const userId = session.userId
    if (userId == null) {
        throw new Error('Personal conversation route requires userId.')
    }

    if (session.isDirect) {
        return `personal:${platform}:${selfId}:direct:${userId}`
    }

    const guildId = session.guildId ?? session.channelId
    if (guildId == null) {
        throw new Error('Personal conversation route requires guildId.')
    }

    return `personal:${platform}:${selfId}:${guildId}:${userId}`
}

export function applyPresetLane(
    bindingKey: string,
    presetLane?: string
): string {
    if (presetLane == null || presetLane.length === 0) {
        return bindingKey
    }

    return `${getBaseBindingKey(bindingKey)}:preset:${presetLane}`
}
