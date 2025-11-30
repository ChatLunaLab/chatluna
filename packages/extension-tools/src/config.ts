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
    fsScopePath: string
    fsSelector: string[]
    fsIgnores: string[]
    bilibili: boolean
    bilibiliTempTimeout: number
    group: boolean
    groupScopeSelector: string[]
    groupWhitelist: string[]
    command: boolean
    commandWithSend: boolean
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
    cron: boolean
    cronScopeSelector: string[]
    send: boolean
    draw: boolean
    music: boolean
    actions: boolean
    drawPrompt: string
    drawCommand: string
    drawSelector: string[]
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
        chat: Schema.boolean().default(true)
    }),

    Schema.object({
        draw: Schema.boolean().default(false),
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
                .default([
                    '请求',
                    'request',
                    'get',
                    'post',
                    '获取',
                    '调用',
                    'api',
                    'http'
                ])
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
            fsScopePath: Schema.string().default(''),
            fsSelector: Schema.array(Schema.string())
                .role('table')
                .default([
                    '文件',
                    'file',
                    '读取',
                    '写入',
                    '查找',
                    '搜索',
                    'read',
                    'write',
                    'search',
                    '路径',
                    'path'
                ]),
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
                ])
        }),
        Schema.object({})
    ]),
    Schema.union([
        Schema.object({
            command: Schema.const(true).required(),
            commandWithSend: Schema.boolean().default(true),
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
            draw: Schema.const(true).required(),
            drawPrompt: Schema.string().role('textarea').default(
                // eslint-disable-next-line max-len
                `1girl, solo, female only, full body, masterpiece, highly detailed, game CG, spring, cherry blossoms, floating sakura, beautiful sky, park, extremely delicate and beautiful girl, high school girl, black blazer jacket, plaid skirt\nshort_hair, blunt_bangs, white_hair/pink_eyes, two-tone hair, gradient hair, by Masaaki Sasamoto, best quality, masterpiece, highres, red-eyeshadow, lipstick.`
            ),
            drawCommand: Schema.string().default('nai {prompt}'),
            drawSelector: Schema.array(Schema.string())
                .role('table')
                .default([
                    '画',
                    'image',
                    'sd',
                    '图',
                    '绘',
                    'draw',
                    '生成',
                    'generate',
                    '创作',
                    'create'
                ])
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
