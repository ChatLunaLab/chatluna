import type { UsageMetadata } from '@langchain/core/messages'
import type { Session } from 'koishi'

export interface TriggerConfig {}

export type TriggerTaskStatus =
    'waiting' | 'running' | 'paused' | 'completed' | 'error'

export type TriggerRunOrigin = 'schedule' | 'event' | 'manual'

export type TriggerRunStatus = 'running' | 'completed' | 'failed' | 'skipped'

export type TriggerMisfirePolicy = 'skip' | 'fire_once'

export type TriggerModelPolicy =
    { type: 'default' } | { type: 'fixed'; model: string }

export type TriggerConversationPolicy =
    | { type: 'task' }
    | { type: 'fresh' }
    | { type: 'route' }
    | { type: 'existing'; conversationId: string }

export type TriggerToolPolicy =
    { type: 'none' } | { type: 'allow'; names: string[] }

export type TriggerGate =
    | { type: 'none' }
    | {
          type: 'model'
          model: TriggerModelPolicy
          prompt?: string
          timeoutSeconds: number
          dailyTokenLimit: number
      }

export type TriggerCondition =
    | {
          type: 'once'
          at: string
      }
    | {
          type: 'calendar'
          timezone: string
          days: number[]
          times: string[]
          misfire: TriggerMisfirePolicy
      }
    | {
          type: 'interval'
          everyMinutes: number
          anchorAt: string
          misfire: TriggerMisfirePolicy
      }
    | {
          type: 'cron'
          expression: string
          timezone: string
          misfire: TriggerMisfirePolicy
      }
    | {
          type: 'window'
          timezone: string
          days: number[]
          start: string
          end: string
          everyMinutes: number
          misfire: TriggerMisfirePolicy
          control: 'fixed' | 'model'
          defaultDecision: 'continue' | 'stop_period'
      }
    | {
          type: 'keyword'
          keywords: string[]
          caseSensitive: boolean
          cooldownMinutes: number
      }
    | {
          type: 'participation'
          withinMinutes: number
          minMessages: number
          minUsers: number
          cooldownMinutes: number
          gate: TriggerGate
      }
    | {
          type: 'inactivity'
          activeWithinMinutes: number
          minMessages: number
          silentMinutes: number
          cooldownMinutes: number
          gate: TriggerGate
      }
    | {
          type: 'semantic'
          topic: string
          withinMinutes: number
          minMessages: number
          cooldownMinutes: number
          gate: Extract<TriggerGate, { type: 'model' }>
      }

export interface TriggerExecution {
    model: TriggerModelPolicy
    conversation: TriggerConversationPolicy
    preset?: string | null
    prompt: string
    timeoutSeconds: number
    tools: TriggerToolPolicy
}

export interface TriggerBotTarget {
    platform: string
    selfId: string
}

export type TriggerDestination =
    | { type: 'direct'; userId: string }
    | { type: 'channel'; guildId?: string; channelId: string }

export interface TriggerTarget {
    bot: TriggerBotTarget
    destination: TriggerDestination
    principalId: string
    observeScope?: 'channel' | 'guild' | 'direct'
    delivery: 'channel' | 'direct' | 'silent'
}

export interface TriggerTaskState {
    status: TriggerTaskStatus
    nextRunAt?: string | null
    suppressedUntil?: string | null
    lastRunAt?: string | null
    lastDecision?: TriggerRunDecision | null
    runCount: number
    lastError?: string | null
    periodKey?: string | null
    occurrenceKey?: string | null
    cooldownUntil?: string | null
    cursor?: Record<string, unknown> | null
}

export interface TriggerTask {
    id: number
    name: string
    enabled: boolean
    condition: TriggerCondition
    execution: TriggerExecution
    target: TriggerTarget
    state: TriggerTaskState
    ownerKey: string
    createdAt: Date
    updatedAt: Date
}

export interface TriggerCreateInput {
    name: string
    enabled?: boolean
    condition: TriggerCondition
    execution: TriggerExecution
    target: TriggerTarget
}

export interface TriggerUpdateInput {
    name: string
    enabled: boolean
    condition: TriggerCondition
    execution: TriggerExecution
    target: TriggerTarget
}

export interface TriggerWakeupInput {
    execution: TriggerExecution
    target: TriggerTarget
}

export interface TriggerActor {
    key: string
    userId: string
    authority: number
    session?: Session
}

export interface TriggerStatus {
    total: number
    enabled: number
    waiting: number
    running: number
    paused: number
    error: number
}

export type TriggerRunDecision =
    | { type: 'continue'; reason?: string }
    | { type: 'stop_period'; reason?: string }
    | { type: 'complete'; reason?: string }
    | { type: 'pause_until'; at: string; reason?: string }
    | { type: 'reschedule'; at: string; reason?: string }

export interface TriggerRun {
    id: string
    taskId: number
    origin: TriggerRunOrigin
    status: TriggerRunStatus
    scheduledAt?: Date | null
    startedAt: Date
    finishedAt?: Date | null
    decision?: TriggerRunDecision | null
    error?: string | null
    usage?: UsageMetadata | null
    createdAt: Date
}

export interface TriggerListFilter {
    ownerKey?: string
    status?: TriggerTaskStatus
    conditionType?: TriggerCondition['type']
    enabled?: boolean
}

export interface TriggerStoreCreateInput extends TriggerCreateInput {
    ownerKey: string
    state: TriggerTaskState
}

export type TriggerStoreUpdate = Partial<
    Pick<
        TriggerTask,
        'name' | 'enabled' | 'condition' | 'execution' | 'target' | 'state'
    >
>

export type TriggerRunCreateInput = Omit<TriggerRun, 'createdAt'> & {
    createdAt?: Date
}

export type TriggerRunFinishInput = Partial<
    Pick<TriggerRun, 'status' | 'finishedAt' | 'decision' | 'error' | 'usage'>
>
