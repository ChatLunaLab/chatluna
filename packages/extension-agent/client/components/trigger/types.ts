import type {
    TriggerCondition,
    TriggerCreateInput,
    TriggerGate,
    TriggerProviderMeta,
    TriggerRunDecision,
    TriggerTaskStatus,
    TriggerUpdateInput
} from '../../../src/types'

export type ConditionOf<T extends TriggerCondition['type']> = Extract<
    TriggerCondition,
    { type: T }
>

export type ScenarioChoice = {
    id: string
    label: string
    kind: 'scheduled' | 'event'
    builtin: boolean
    provider?: TriggerProviderMeta
}

export interface TriggerRouteChoice {
    label: string
    platform: string
    selfId: string
}

export const builtinScenarioLabels: Record<string, string> = {
    once: '指定时间执行一次',
    calendar: '每天或每周固定时间',
    interval: '固定间隔',
    cron: '高级 Cron',
    window: '时间段内循环检查',
    keyword: '消息包含关键词',
    participation: '群聊达到参与门槛',
    inactivity: '活跃后沉默',
    semantic: '语义主题'
}

export function toScenarios(
    providers: TriggerProviderMeta[]
): ScenarioChoice[] {
    return providers.map((item) => ({
        id: item.id,
        label: item.label || builtinScenarioLabels[item.id] || item.id,
        kind: item.kind,
        builtin: item.builtin,
        provider: item
    }))
}

export const statusLabels: Record<TriggerTaskStatus, string> = {
    waiting: '等待中',
    running: '执行中',
    paused: '已暂停',
    completed: '已完成',
    error: '异常'
}

export const decisionLabels: Record<TriggerRunDecision['type'], string> = {
    continue: '继续',
    stop_period: '停止本周期',
    complete: '完成任务',
    pause_until: '暂停',
    reschedule: '重新安排'
}

export const dayOptions = [
    { value: 1, label: '周一' },
    { value: 2, label: '周二' },
    { value: 3, label: '周三' },
    { value: 4, label: '周四' },
    { value: 5, label: '周五' },
    { value: 6, label: '周六' },
    { value: 0, label: '周日' }
]

export const localTimezone =
    Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'

const intl = Intl as typeof Intl & {
    supportedValuesOf?: (key: 'timeZone') => string[]
}

export const timezones = Array.from(
    new Set([
        localTimezone,
        ...(intl.supportedValuesOf?.('timeZone') ?? [
            'UTC',
            'Asia/Shanghai',
            'Asia/Tokyo',
            'Europe/London',
            'America/New_York',
            'America/Los_Angeles'
        ])
    ])
)

export function createGate(): Extract<TriggerGate, { type: 'model' }> {
    return {
        type: 'model',
        model: { type: 'default' },
        prompt: '',
        timeoutSeconds: 30,
        dailyTokenLimit: 20000
    }
}

export function createCondition(
    type: string,
    provider?: TriggerProviderMeta
): TriggerCondition {
    if (provider != null && !provider.builtin) {
        return {
            type: 'extension',
            provider: provider.id,
            config: structuredClone(provider.defaultConfig)
        }
    }
    if (provider?.builtin && provider.defaultConfig != null) {
        return {
            type: provider.id as TriggerCondition['type'],
            ...(structuredClone(provider.defaultConfig) as object)
        } as TriggerCondition
    }
    if (type === 'once') {
        return { type, at: new Date(Date.now() + 3600000).toISOString() }
    }
    if (type === 'calendar') {
        return {
            type,
            timezone: localTimezone,
            days: [0, 1, 2, 3, 4, 5, 6],
            times: ['09:00'],
            misfire: 'skip'
        }
    }
    if (type === 'interval') {
        return {
            type,
            everyMinutes: 60,
            anchorAt: new Date().toISOString(),
            misfire: 'skip'
        }
    }
    if (type === 'cron') {
        return {
            type,
            expression: '0 9 * * *',
            timezone: localTimezone,
            misfire: 'skip'
        }
    }
    if (type === 'window') {
        return {
            type,
            timezone: localTimezone,
            days: [0, 1, 2, 3, 4, 5, 6],
            start: '08:00',
            end: '12:00',
            everyMinutes: 20,
            misfire: 'skip',
            control: 'fixed',
            defaultDecision: 'continue'
        }
    }
    if (type === 'keyword') {
        return {
            type,
            keywords: ['keyword'],
            caseSensitive: false,
            cooldownMinutes: 10
        }
    }
    if (type === 'participation') {
        return {
            type,
            withinMinutes: 10,
            minMessages: 10,
            minUsers: 3,
            cooldownMinutes: 30,
            gate: { type: 'none' }
        }
    }
    if (type === 'inactivity') {
        return {
            type,
            activeWithinMinutes: 10,
            minMessages: 8,
            silentMinutes: 20,
            cooldownMinutes: 30,
            gate: { type: 'none' }
        }
    }
    return {
        type: 'semantic',
        topic: 'topic',
        withinMinutes: 10,
        minMessages: 5,
        cooldownMinutes: 30,
        gate: createGate()
    }
}

export function createInput(): TriggerCreateInput & TriggerUpdateInput {
    return {
        name: '',
        enabled: true,
        condition: createCondition('once'),
        execution: {
            model: { type: 'default' },
            conversation: { type: 'task' },
            preset: null,
            prompt: '',
            timeoutSeconds: 120,
            tools: { type: 'none' }
        },
        target: {
            bot: { platform: '', selfId: '' },
            destination: { type: 'channel', guildId: '', channelId: '' },
            principalId: '',
            delivery: 'channel'
        }
    }
}

export function isMessageCondition(
    condition: TriggerCondition | string,
    providers?: TriggerProviderMeta[]
) {
    if (typeof condition === 'string') {
        if (
            condition === 'keyword' ||
            condition === 'participation' ||
            condition === 'inactivity' ||
            condition === 'semantic'
        ) {
            return true
        }
        return (
            providers?.find((item) => item.id === condition)?.kind === 'event'
        )
    }
    if (condition.type === 'extension') {
        return (
            providers?.find((item) => item.id === condition.provider)?.kind ===
            'event'
        )
    }
    return (
        condition.type === 'keyword' ||
        condition.type === 'participation' ||
        condition.type === 'inactivity' ||
        condition.type === 'semantic'
    )
}

export function conditionKey(condition: TriggerCondition) {
    return condition.type === 'extension' ? condition.provider : condition.type
}

export function statusType(status: TriggerTaskStatus) {
    if (status === 'waiting') return 'success'
    if (status === 'running') return 'warning'
    if (status === 'error') return 'danger'
    return 'info'
}

export function formatDate(value?: Date | string | null) {
    if (!value) return '未安排'
    return new Date(value).toLocaleString()
}

export function formatDecision(decision: TriggerRunDecision) {
    return decision.reason
        ? `${decisionLabels[decision.type]}：${decision.reason}`
        : decisionLabels[decision.type]
}
