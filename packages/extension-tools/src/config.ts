import { Schema } from 'koishi'
import { ChatLunaPlugin } from 'koishi-plugin-chatluna/services/chat'

export interface Config extends ChatLunaPlugin.Config {
    request: boolean
    requestMaxOutputLength: number
    requestSelector: string[]
    requestHeaders: {
        matcher: string
        headers: Record<string, string>
    }[]
    bilibili: boolean
    bilibiliTempTimeout: number
    group: boolean
    groupScopeSelector: string[]
    groupWhitelist: string[]
    command: boolean
    commandWithSend: boolean
    commandAutoExecute: boolean
    commandBlacklist: string[]
    commandList: {
        command: string
        description: string
        selector: string[]
        confirm: boolean
    }[]
    chat: boolean
    todos: boolean
    todosNotify: boolean
    cron: boolean
    cronScopeSelector: string[]

    music: boolean

    musicSelector: string[]
}

export const Config: Schema<Config> = Schema.intersect([
    ChatLunaPlugin.Config,

    Schema.object({
        todos: Schema.boolean().default(true),
        todosNotify: Schema.boolean().default(false),
        chat: Schema.boolean().default(true)
    }),

    Schema.object({
        music: Schema.boolean().default(false)
    }),
    Schema.object({
        request: Schema.boolean().default(true),
        fs: Schema.boolean().default(false),
        command: Schema.boolean().default(false),
        cron: Schema.boolean().default(true)
    }),
    Schema.object({
        group: Schema.boolean().default(false)
    }),

    Schema.union([
        Schema.object({
            request: Schema.const(true).required(),
            requestMaxOutputLength: Schema.number()
                .min(500)
                .max(3860000)
                .default(58600),
            requestSelector: Schema.array(Schema.string())
                .default([])
                .role('table'),
            requestHeaders: Schema.array(
                Schema.object({
                    matcher: Schema.string().description(
                        'Domain matcher pattern (e.g., *.example.com, api.github.com)'
                    ),
                    headers: Schema.dict(String)
                        .default({})
                        .role('table')
                        .description('Headers to apply for this domain')
                })
            ).default([])
        }),
        Schema.object({})
    ]),
    Schema.union([
        Schema.object({
            command: Schema.const(true).required(),
            commandWithSend: Schema.boolean().default(true),
            commandAutoExecute: Schema.boolean()
                .default(false)
                .description(
                    '⚠️ DANGEROUS: Allow all commands to execute without confirmation. This may cause unexpected operations. Use at your own risk.'
                ),
            commandList: Schema.array(
                Schema.object({
                    command: Schema.string(),
                    description: Schema.string(),
                    confirm: Schema.boolean().default(true),
                    selector: Schema.array(Schema.string())
                        .role('table')
                        .default([])
                })
            ).role('table'),
            commandBlacklist: Schema.array(Schema.string())
                .role('table')
                .default([
                    'command',
                    'channel',
                    'inspect',
                    'plugin',
                    'user',
                    'usage'
                ])
        }),
        Schema.object({})
    ]),
    Schema.union([
        Schema.object({
            group: Schema.const(true).required(),
            groupScopeSelector: Schema.array(Schema.string()),
            groupWhitelist: Schema.array(Schema.string()).default([])
        }),
        Schema.object({})
    ]),
    Schema.union([
        Schema.object({
            cron: Schema.const(true).required(),
            cronScopeSelector: Schema.array(Schema.string()).default([])
        }),
        Schema.object({})
    ]),

    Schema.union([
        Schema.object({
            music: Schema.const(true).required(),
            musicSelector: Schema.array(Schema.string())
                .role('table')
                .default([
                    '音乐',
                    'music',
                    '歌曲',
                    'song',
                    '音频',
                    'audio',
                    '创作',
                    'create',
                    '生成',
                    'generate'
                ])
        }),
        Schema.object({})
    ])
]).i18n({
    'zh-CN': require('./locales/zh-CN.schema.yml'),
    'en-US': require('./locales/en-US.schema.yml')
}) as Schema<Config>

export const inject = {
    required: ['chatluna'],
    optional: ['chatluna_storage', 'database']
}

export const name = 'chatluna-plugin-common'
