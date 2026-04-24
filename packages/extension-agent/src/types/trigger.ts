import type {
    MessageContentComplex,
    UsageMetadata
} from '@langchain/core/messages'
import type { Awaitable, Session } from 'koishi'
import type { ToolMask } from 'koishi-plugin-chatluna/llm-core/agent'
import type { ConversationRecord } from 'koishi-plugin-chatluna/services/chat'
import type { Message } from 'koishi-plugin-chatluna'
import type { ZodTypeAny } from 'zod'

export interface WakeupRouting {
    platform: string
    selfId: string
    userId: string
    username?: string
    guildId?: string
    channelId?: string
    isDirect: boolean
}

export type WakeupScope = 'personal' | 'shared'

export type WakeupTarget = Session | WakeupRouting | { bindingKey: string }

export function routingFromSession(s: Session): WakeupRouting {
    return {
        platform: s.platform,
        selfId: s.selfId,
        userId: s.userId,
        username: s.username,
        guildId: s.guildId ?? undefined,
        channelId: s.channelId ?? undefined,
        isDirect: s.isDirect
    }
}

export function bindingKeyFromRouting(
    routing: WakeupRouting,
    scope: WakeupScope = 'personal'
): string {
    if (scope === 'shared') {
        return `shared:${routing.platform}:${routing.selfId}:${routing.guildId ?? routing.channelId ?? routing.userId}`
    }
    if (routing.isDirect) {
        return `personal:${routing.platform}:${routing.selfId}:direct:${routing.userId}`
    }
    return `personal:${routing.platform}:${routing.selfId}:${routing.guildId ?? routing.channelId}:${routing.userId}`
}

export function bindingKeyFromSession(
    s: Session,
    scope: WakeupScope = 'personal'
): string {
    return bindingKeyFromRouting(routingFromSession(s), scope)
}

export type ParseBindingKeyError = 'invalid-binding-key' | 'no-routing'

export function parseBindingKey(bindingKey: string): {
    routing?: WakeupRouting
    error?: ParseBindingKeyError
} {
    const base = bindingKey.split(':preset:')[0]
    const parts = base.split(':')
    if (parts[0] === 'shared') {
        return { error: 'no-routing' }
    }
    if (parts[0] === 'personal' && parts[3] === 'direct' && parts.length >= 5) {
        return {
            routing: {
                platform: parts[1],
                selfId: parts[2],
                userId: parts[4],
                isDirect: true
            }
        }
    }
    if (parts[0] === 'personal' && parts.length >= 5) {
        return { error: 'no-routing' }
    }
    return { error: 'invalid-binding-key' }
}

/**
 * Common fields shared by any wakeup invocation, the per-task wakeup template,
 * and the webui adhoc input.
 */
export interface WakeupTemplate {
    message?: string | MessageContentComplex[]
    messageName?: string
    variables?: Record<string, unknown>
    execMode?: 'chain' | 'direct'
    chatMode?: string
    toolMask?: ToolMask
    replyTo?: 'channel' | 'user' | 'silent' | 'callback'
    replyUserId?: string
    onReply?: (msg: Message) => Awaitable<void>
    timeout?: number
    newConversation?: boolean
    presetLane?: string | null
    conversationId?: string | null
}

export interface WakeupSource {
    kind: string
    taskId?: number
    providerKind?: string
    detail?: unknown
}

export interface WakeupAction extends WakeupTemplate {
    /** New unified entry. */
    target?: WakeupTarget
    /** @deprecated use {@link target} */
    bindingKey?: string
    /** @deprecated use {@link target} */
    session?: Session
    /** @deprecated use {@link target} */
    routing?: WakeupRouting
    source: WakeupSource
    requestId?: string
    signal?: AbortSignal
}

export interface WakeupResult {
    ok: boolean
    deferred?: {
        reason: 'bot-offline' | 'bot-not-found'
        pendingKey: string
    }
    error?: {
        code: string
        message: string
    }
    conversation?: ConversationRecord
    reply?: Message
    requestId?: string
    stats?: {
        tokens?: UsageMetadata
        durationMs: number
    }
}

export type TriggerTaskTemplate = WakeupTemplate

export type TriggerTaskMissedRunPolicy = 'skip' | 'fire_once'

export interface TriggerTaskParams {
    missedRunPolicy?: TriggerTaskMissedRunPolicy
    recipient?: string | null
    executorUserId?: string | null
    [key: string]: unknown
}

export interface TriggerProviderPrepareContext {
    input: Partial<TriggerCreateTaskInput> | Partial<TriggerTask>
    task?: TriggerTask
}

export interface TriggerProviderPassiveContext {
    session: Session
    task: TriggerTask
    content: string
}

export interface TriggerProviderPassiveMatch {
    message?: string | MessageContentComplex[]
    messageName?: string
    variables?: Record<string, unknown>
    detail?: unknown
}

export interface TriggerProviderAfterFireContext {
    task: TriggerTask
    currentDate?: Date
    firedAt?: Date
}

export interface TriggerProviderRescheduleContext {
    task: TriggerTask
    after: Date
}

export interface TriggerProviderLifecycleContext {
    task: TriggerTask
}

export interface TriggerProviderFireResultContext {
    task: TriggerTask
    result: WakeupResult
}

export type TriggerProviderDescriptor = Pick<
    TriggerProvider,
    'kind' | 'name' | 'description' | 'passive' | 'scheduled' | 'needsMessage'
> & {
    enabled?: boolean
    schema?: Record<string, unknown>
}

export interface TriggerProviderItemConfig {
    enabled: boolean
}

export interface TriggerConfig {
    providers: Record<string, TriggerProviderItemConfig>
}

export interface TriggerProvider {
    kind: string
    name: string
    description: string
    passive?: boolean
    scheduled?: boolean
    needsMessage?: boolean
    schema?: ZodTypeAny
    prepare?: (
        ctx: TriggerProviderPrepareContext
    ) => Awaitable<Partial<TriggerTask>>
    match?: (
        ctx: TriggerProviderPassiveContext
    ) => Awaitable<TriggerProviderPassiveMatch | null>
    afterFire?: (
        ctx: TriggerProviderAfterFireContext
    ) => Awaitable<Partial<TriggerTask> | void>
    reschedule?: (
        ctx: TriggerProviderRescheduleContext
    ) => Awaitable<Partial<TriggerTask>>
    onTaskCreate?: (ctx: TriggerProviderLifecycleContext) => Awaitable<void>
    onTaskRemove?: (ctx: TriggerProviderLifecycleContext) => Awaitable<void>
    onTaskFire?: (ctx: TriggerProviderFireResultContext) => Awaitable<void>
}

export interface TriggerRoutingChoice {
    label: string
    platform: string
    selfId: string
}

export interface TriggerTargetEntry {
    id: string
    name?: string
    avatar?: string
}

export interface TriggerChannelEntry extends TriggerTargetEntry {
    type: number
}

export interface TriggerTargetBundle {
    guilds: TriggerTargetEntry[]
    friends: TriggerTargetEntry[]
}

export type TriggerAdhocWakeupInput = Partial<WakeupRouting> &
    WakeupTemplate & {
        bindingKey?: string
    }

export interface TriggerTask {
    id: number
    providerKind: string | null
    enabled: boolean
    name?: string | null
    bindingKey: string
    presetLane?: string | null
    conversationId?: string | null
    selfId: string
    platform: string
    userId: string
    username?: string | null
    guildId?: string | null
    channelId?: string | null
    isDirect: boolean
    wakeupTemplate: TriggerTaskTemplate
    params: TriggerTaskParams | null
    lastFiredAt?: Date | null
    nextFireAt?: Date | null
    fireCount: number
    lastError?: string | null
    source: 'webui' | 'agent' | 'command' | 'plugin'
    createdBy: string
    createdAt: Date
    updatedAt: Date
}

export interface TriggerCreateTaskInput {
    providerKind?: string | null
    enabled?: boolean
    name?: string
    bindingKey: string
    presetLane?: string | null
    conversationId?: string | null
    selfId: string
    platform: string
    userId: string
    username?: string | null
    guildId?: string | null
    channelId?: string | null
    isDirect: boolean
    wakeupTemplate: TriggerTaskTemplate
    params?: TriggerTaskParams | null
    nextFireAt?: Date | string
    source?: TriggerTask['source']
    createdBy: string
}

export interface TriggerListTaskFilter {
    providerKind?: string | null
    enabled?: boolean
}

export interface TriggerStatus {
    total: number
    enabled: number
    scheduled: number
    passive: number
}

declare module 'koishi' {
    interface Tables {
        chatluna_trigger_task: TriggerTask
    }
}
