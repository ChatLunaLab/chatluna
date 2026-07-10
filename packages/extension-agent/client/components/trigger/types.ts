import type {
    TriggerCondition,
    TriggerCreateInput,
    TriggerGate,
    TriggerTaskStatus,
    TriggerUpdateInput
} from '../../../src/types'

export type ConditionOf<T extends TriggerCondition['type']> = Extract<
    TriggerCondition,
    { type: T }
>

export interface TriggerRouteChoice {
    label: string
    platform: string
    selfId: string
}

export const scenarios: {
    type: TriggerCondition['type']
    label: string
}[] = [
    { type: 'once', label: '指定时间执行一次' },
    { type: 'calendar', label: '每天或每周固定时间' },
    { type: 'interval', label: '固定间隔' },
    { type: 'cron', label: '高级 Cron' },
    { type: 'window', label: '时间段内循环检查' },
    { type: 'keyword', label: '消息包含关键词' },
    { type: 'participation', label: '群聊达到参与门槛' },
    { type: 'inactivity', label: '活跃后沉默' },
    { type: 'semantic', label: '语义主题' }
]

export const statusLabels: Record<TriggerTaskStatus, string> = {
    waiting: '等待中',
    running: '执行中',
    paused: '已暂停',
    completed: '已完成',
    error: '异常'
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
    type: TriggerCondition['type']
): TriggerCondition {
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
            keywords: [],
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
        topic: '',
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
            destination: { type: 'channel', channelId: '' },
            principalId: '',
            delivery: 'channel'
        }
    }
}

export function isMessageCondition(type: TriggerCondition['type']) {
    return (
        type === 'keyword' ||
        type === 'participation' ||
        type === 'inactivity' ||
        type === 'semantic'
    )
}
