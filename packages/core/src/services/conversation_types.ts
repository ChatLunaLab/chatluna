import type { Session } from 'koishi'

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
    tool_calls?: unknown
    additional_kwargs?: string | null
    additional_kwargs_binary?: ArrayBuffer | null
    rawId?: string | null
    createdAt?: Date | null
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

export interface ResolveConversationContextOptions {
    presetLane?: string
    conversationId?: string
}

export function computeBaseBindingKey(
    session: Session,
    routeMode: RouteMode,
    routeKey?: string | null
): string {
    const platform = session.platform ?? 'unknown'
    const selfId = session.selfId ?? 'unknown'
    const guildId = session.guildId ?? 'unknown'
    const userId = session.userId ?? 'unknown'

    if (routeMode === 'custom') {
        return `custom:${routeKey ?? 'default'}`
    }

    if (routeMode === 'shared') {
        return `shared:${platform}:${selfId}:${guildId}`
    }

    if (session.isDirect) {
        return `personal:${platform}:${selfId}:direct:${userId}`
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

    return `${bindingKey}:preset:${presetLane}`
}
