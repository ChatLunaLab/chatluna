import { ChatLunaPlugin } from 'koishi-plugin-chatluna/services/chat'
import { Context, Logger, Schema } from 'koishi'
import { GeminiClient } from './client'
import { createLogger } from 'koishi-plugin-chatluna/utils/logger'

export let logger: Logger
export const reusable = true

export function apply(ctx: Context, config: Config) {
    logger = createLogger(ctx, 'chatluna-gemini-adapter')

    ctx.on('ready', async () => {
        const plugin = new ChatLunaPlugin(ctx, config, config.platform)

        plugin.parseConfig((config) => {
            return config.apiKeys
                .filter(([apiKey, _, enabled]) => {
                    return apiKey.length > 0 && enabled
                })
                .map(([apiKey, apiEndpoint]) => {
                    return {
                        apiKey,
                        apiEndpoint,
                        platform: config.platform,
                        chatLimit: config.chatTimeLimit,
                        timeout: config.timeout,
                        maxRetries: config.maxRetries,
                        concurrentMaxSize: config.chatConcurrentMaxSize
                    }
                })
        })

        plugin.registerClient(() => new GeminiClient(ctx, config, plugin))

        await plugin.initClient()
    })
}

export interface Config extends ChatLunaPlugin.Config {
    apiKeys: [string, string, boolean][]
    maxContextRatio: number
    platform: string
    temperature: number
    googleSearch: boolean
    codeExecution: boolean
    urlContext: boolean
    searchThreshold: number
    groundingContentDisplay: boolean
    nonStreaming: boolean
    imageGeneration: boolean
    thinkingBudget: number
    includeThoughts: boolean
}

export const Config: Schema<Config> = Schema.intersect([
    ChatLunaPlugin.Config,
    Schema.object({
        platform: Schema.string().default('gemini'),
        apiKeys: Schema.array(
            Schema.tuple([
                Schema.string().role('secret').default(''),
                Schema.string().default(
                    'https://generativelanguage.googleapis.com/v1beta'
                ),
                Schema.boolean().default(true)
            ])
        )
            .default([[]])
            .role('table')
    }),
    Schema.object({
        maxContextRatio: Schema.number()
            .min(0)
            .max(1)
            .step(0.0001)
            .role('slider')
            .default(0.35),
        temperature: Schema.percent().min(0).max(2).step(0.1).default(1),
        googleSearch: Schema.boolean().default(false),
        codeExecution: Schema.boolean().default(false),
        urlContext: Schema.boolean().default(false),
        thinkingBudget: Schema.number().min(-1).max(24576).default(-1),
        includeThoughts: Schema.boolean().default(false),
        nonStreaming: Schema.boolean().default(false),
        imageGeneration: Schema.boolean().default(false),
        groundingContentDisplay: Schema.boolean().default(false),
        searchThreshold: Schema.number().min(0).max(1).step(0.1).default(0.5)
    })
]).i18n({
    'zh-CN': require('./locales/zh-CN.schema.yml'),
    'en-US': require('./locales/en-US.schema.yml')
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
}) as any

export const inject = {
    required: ['chatluna'],
    optional: ['chatluna_storage']
}

export const name = 'chatluna-google-gemini-adapter'
