import { ChatLunaPlugin } from 'koishi-plugin-chatluna/services/chat'
import { Context, Logger, Schema } from 'koishi'
import { GeminiClient } from './client'
import { createLogger } from 'koishi-plugin-chatluna/utils/logger'

export let logger: Logger
export const reusable = true

export function apply(ctx: Context, config: Config) {
    const plugin = new ChatLunaPlugin(ctx, config, config.platform)

    logger = createLogger(ctx, 'chatluna-gemini-adapter')

    ctx.on('ready', async () => {
        plugin.registerToService()

        await plugin.parseConfig((config) => {
            return config.apiKeys.map(([apiKey, apiEndpoint]) => {
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

        plugin.registerClient((ctx) => new GeminiClient(ctx, config, plugin))

        await plugin.initClients()
    })
}

export interface Config extends ChatLunaPlugin.Config {
    apiKeys: [string, string][]
    maxTokens: number
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
                Schema.string().role('secret'),
                Schema.string().default(
                    'https://generativelanguage.googleapis.com/v1beta'
                )
            ])
        ).default([['', 'https://generativelanguage.googleapis.com/v1beta']])
    }),
    Schema.object({
        maxTokens: Schema.number()
            .min(16)
            .max(2_097_000)
            .step(16)
            .default(8064),
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

export const inject = ['chatluna']

export const name = 'chatluna-google-gemini-adapter'
