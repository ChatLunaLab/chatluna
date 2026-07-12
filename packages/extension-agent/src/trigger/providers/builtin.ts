import type { TriggerProviderDef } from '../../types/trigger'
import {
    calendarConfigSchema,
    cronConfigSchema,
    inactivityConfigSchema,
    intervalConfigSchema,
    keywordConfigSchema,
    onceConfigSchema,
    participationConfigSchema,
    semanticConfigSchema,
    windowConfigSchema
} from '../schema'

export const builtinProviderDefs: TriggerProviderDef[] = [
    {
        id: 'once',
        label: '指定时间执行一次',
        description: '在指定时间触发一次。',
        kind: 'scheduled',
        schema: onceConfigSchema,
        defaultConfig: {
            at: new Date(Date.now() + 3600000).toISOString()
        }
    },
    {
        id: 'calendar',
        label: '每天或每周固定时间',
        description: '按星期几与时间点触发。',
        kind: 'scheduled',
        schema: calendarConfigSchema,
        defaultConfig: {
            timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
            days: [0, 1, 2, 3, 4, 5, 6],
            times: ['09:00'],
            misfire: 'skip'
        }
    },
    {
        id: 'interval',
        label: '固定间隔',
        description: '按固定间隔重复触发。',
        kind: 'scheduled',
        schema: intervalConfigSchema,
        defaultConfig: {
            everyMinutes: 60,
            anchorAt: new Date().toISOString(),
            misfire: 'skip'
        }
    },
    {
        id: 'cron',
        label: '高级 Cron',
        description: '使用 Cron 表达式触发。',
        kind: 'scheduled',
        schema: cronConfigSchema,
        defaultConfig: {
            expression: '0 9 * * *',
            timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
            misfire: 'skip'
        }
    },
    {
        id: 'window',
        label: '时间段内循环检查',
        description: '在时间窗口内按间隔触发。',
        kind: 'scheduled',
        schema: windowConfigSchema,
        defaultConfig: {
            timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
            days: [0, 1, 2, 3, 4, 5, 6],
            start: '08:00',
            end: '12:00',
            everyMinutes: 20,
            misfire: 'skip',
            control: 'fixed',
            defaultDecision: 'continue'
        }
    },
    {
        id: 'keyword',
        label: '消息包含关键词',
        description: '匹配消息关键词后触发。',
        kind: 'event',
        schema: keywordConfigSchema,
        defaultConfig: {
            keywords: ['keyword'],
            caseSensitive: false,
            cooldownMinutes: 10
        },
        cooldownMinutes: (config) =>
            keywordConfigSchema.parse(config).cooldownMinutes
    },
    {
        id: 'participation',
        label: '群聊达到参与门槛',
        description: '消息量与人数达到门槛后触发。',
        kind: 'event',
        schema: participationConfigSchema,
        defaultConfig: {
            withinMinutes: 10,
            minMessages: 10,
            minUsers: 3,
            cooldownMinutes: 30,
            gate: { type: 'none' }
        },
        cooldownMinutes: (config) =>
            participationConfigSchema.parse(config).cooldownMinutes
    },
    {
        id: 'inactivity',
        label: '活跃后沉默',
        description: '活跃后静默一段时间触发。',
        kind: 'event',
        schema: inactivityConfigSchema,
        defaultConfig: {
            activeWithinMinutes: 10,
            minMessages: 8,
            silentMinutes: 20,
            cooldownMinutes: 30,
            gate: { type: 'none' }
        },
        cooldownMinutes: (config) =>
            inactivityConfigSchema.parse(config).cooldownMinutes
    },
    {
        id: 'semantic',
        label: '语义主题',
        description: '按主题语义判断是否触发。',
        kind: 'event',
        schema: semanticConfigSchema,
        defaultConfig: {
            topic: 'topic',
            withinMinutes: 10,
            minMessages: 5,
            cooldownMinutes: 30,
            gate: {
                type: 'model',
                model: { type: 'default' },
                timeoutSeconds: 30,
                dailyTokenLimit: 20000
            }
        },
        cooldownMinutes: (config) =>
            semanticConfigSchema.parse(config).cooldownMinutes
    }
]

export function isBuiltinId(id: string) {
    return builtinProviderDefs.some((item) => item.id === id)
}

export const BUILTIN_IDS = builtinProviderDefs.map((item) => item.id)
