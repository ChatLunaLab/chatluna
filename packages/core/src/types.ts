import { AIMessage, MessageContent } from '@langchain/core/messages'
import { h, Session } from 'koishi'

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

export type ConversationResolutionErrorCode =
    | 'ambiguous_target'
    | 'target_outside_route'

export class ConversationResolutionError extends Error {
    constructor(public readonly code: ConversationResolutionErrorCode) {
        super(
            code === 'ambiguous_target'
                ? 'Conversation target is ambiguous.'
                : 'Conversation does not belong to current route.'
        )
    }
}

export class ConversationNotFoundError extends Error {
    constructor() {
        super('Conversation not found.')
        this.name = 'ConversationNotFoundError'
    }
}

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

export class ConstraintLockedError extends Error {
    constructor(public readonly action: ConstraintAction) {
        super(`Conversation ${action} is locked by constraint.`)
        this.name = 'ConstraintLockedError'
    }
}

export class ConstraintDisabledError extends Error {
    constructor(public readonly action: ConstraintAction) {
        super(`Conversation ${action} is disabled by constraint.`)
        this.name = 'ConstraintDisabledError'
    }
}

export type ConstraintFixedField = 'model' | 'preset' | 'chatMode'

const FIXED_FIELD_LABEL: Record<ConstraintFixedField, string> = {
    model: 'Model',
    preset: 'Preset',
    chatMode: 'Chat mode'
}

export class ConstraintFixedError extends Error {
    constructor(
        public readonly field: ConstraintFixedField,
        public readonly value: string
    ) {
        super(`${FIXED_FIELD_LABEL[field]} is fixed to ${value}.`)
        this.name = 'ConstraintFixedError'
    }
}

export class InvalidChatModeError extends Error {
    constructor(public readonly mode: string) {
        super(`Chat mode ${mode} not found.`)
        this.name = 'InvalidChatModeError'
    }
}

export class AdminRequiredError extends Error {
    constructor() {
        super('Conversation management requires administrator permission.')
        this.name = 'AdminRequiredError'
    }
}

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
