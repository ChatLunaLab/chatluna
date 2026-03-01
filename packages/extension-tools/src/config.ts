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
    fs: boolean
    fsNotify: boolean
    fsScopePath: string
    fsSelector: string[]
    fsIgnores: string[]
    bashAllowedCommands: string[]
    bashBlockedCommands: string[]
    bashTimeout: number
    bashAutoExecute: boolean
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
    think: boolean
    todos: boolean
    todosNotify: boolean
    cron: boolean
    cronScopeSelector: string[]
    send: boolean

    music: boolean
    actions: boolean

    musicSelector: string[]
    actionsList: {
        name: string
        description: string
        openAPISpec: string
        headers: Record<string, string>
        selector: string[]
    }[]
}

export const Config: Schema<Config> = Schema.intersect([
    ChatLunaPlugin.Config,

    Schema.object({
        think: Schema.boolean().default(false),
        send: Schema.boolean().default(true),
        todos: Schema.boolean().default(true),
        todosNotify: Schema.boolean().default(true),
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
        group: Schema.boolean().default(false),
        actions: Schema.boolean().default(false)
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
            fs: Schema.const(true).required(),
            fsNotify: Schema.boolean().default(true),
            fsScopePath: Schema.string().default(''),
            fsSelector: Schema.array(Schema.string()).role('table').default([]),
            fsIgnores: Schema.array(Schema.string())
                .role('table')
                .default([
                    '**/node_modules/**',
                    '**/.git/**',
                    '**/dist/**',
                    '**/build/**',
                    '**/.yarn/**',
                    '**/coverage/**',
                    '**/.next/**',
                    '**/.nuxt/**',
                    '**/out/**',
                    '**/.cache/**',
                    '**/.vscode/**',
                    '**/.idea/**',
                    '**/temp/**',
                    '**/tmp/**'
                ]),
            bashAllowedCommands: Schema.array(Schema.string())
                .role('table')
                .default([])
                .description(
                    'Whitelist of allowed commands. When non-empty, only listed commands can be executed.'
                ),
            bashBlockedCommands: Schema.array(Schema.string())
                .role('table')
                .default([])
                .description('Blacklist of commands that are always rejected.'),
            bashTimeout: Schema.number()
                .min(1000)
                .max(300000)
                .default(30000)
                .description(
                    'Default timeout for bash commands in milliseconds.'
                ),
            bashAutoExecute: Schema.boolean()
                .default(false)
                .description(
                    '⚠️ DANGEROUS: Skip user confirmation for high-risk commands. Use at your own risk.'
                )
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
    ]),
    Schema.union([
        Schema.object({
            actions: Schema.const(true).required(),
            actionsList: Schema.array(
                Schema.object({
                    name: Schema.string(),
                    description: Schema.string(),
                    headers: Schema.dict(String).default({}).role('table'),
                    selector: Schema.array(Schema.string())
                        .default([])
                        .role('table'),
                    openAPISpec: Schema.string().role('textarea')
                })
            ).role('table')
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
