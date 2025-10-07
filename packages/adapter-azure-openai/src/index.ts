import { ChatLunaPlugin } from 'koishi-plugin-chatluna/services/chat'
import { Context, Logger, Schema } from 'koishi'
import { OpenAIClient } from './client'
import { createLogger } from 'koishi-plugin-chatluna/utils/logger'
import { AzureOpenAIClientConfig } from './types'

export let logger: Logger

export function apply(ctx: Context, config: Config) {
    logger = createLogger(ctx, 'chatluna-openai-adapter')

    ctx.on('ready', async () => {
        const plugin = new ChatLunaPlugin<AzureOpenAIClientConfig, Config>(
            ctx,
            config,
            'azure'
        )

        plugin.parseConfig((config) => {
            return config.apiKeys
                .filter(([apiKey, _, enabled]) => {
                    return apiKey.length > 0 && enabled
                })
                .map(([apiKey, apiEndpoint]) => {
                    return {
                        apiKey,
                        apiEndpoint,
                        // [{model,xx}] => Record<string(model),{}>
                        supportModels: config.supportModels.reduce(
                            (acc, value) => {
                                acc[value.model] = value
                                return acc
                            },
                            {}
                        ),
                        platform: 'azure',
                        chatLimit: config.chatTimeLimit,
                        timeout: config.timeout,
                        maxRetries: config.maxRetries,
                        concurrentMaxSize: config.chatConcurrentMaxSize
                    }
                })
        })

        plugin.registerClient((ctx) => new OpenAIClient(ctx, config, plugin))

        await plugin.initClient()
    })
}

export interface Config extends ChatLunaPlugin.Config {
    apiKeys: [string, string, boolean][]
    maxContextRatio: number
    supportModels: {
        model: string
        modelType: string
        modelVersion: string
        contextSize: number
    }[]
    temperature: number
    presencePenalty: number
    frequencyPenalty: number
}

export const Config: Schema<Config> = Schema.intersect([
    ChatLunaPlugin.Config,
    Schema.object({
        apiKeys: Schema.array(
            Schema.tuple([
                Schema.string().role('secret').required(),
                Schema.string().default('https://xxx.openai.azure.com'),
                Schema.boolean().default(true)
            ])
        )
            .default([[]])
            .role('table')
    }),

    Schema.object({
        supportModels: Schema.array(
            Schema.object({
                model: Schema.string().required(),
                modelType: Schema.union([
                    'LLM 大语言模型',
                    'LLM 大语言模型（函数调用）',
                    'Embeddings 嵌入模型'
                ]).default('LLM 大语言模型'),
                modelVersion: Schema.string().default('2023-03-15-preview'),
                contextSize: Schema.number().default(12000)
            }).role('table')
        ).default([
            {
                model: 'gpt-4o',
                modelType: 'LLM 大语言模型',
                modelVersion: '2023-03-15-preview',
                contextSize: 128000
            }
        ]),
        maxContextRatio: Schema.number()
            .min(0)
            .max(1)
            .step(0.0001)
            .role('slider')
            .default(0.35),
        temperature: Schema.percent().min(0).max(2).step(0.1).default(1),
        presencePenalty: Schema.number().min(-2).max(2).step(0.1).default(0),
        frequencyPenalty: Schema.number().min(-2).max(2).step(0.1).default(0)
    })
]).i18n({
    'zh-CN': require('./locales/zh-CN.schema.yml'),
    'en-US': require('./locales/en-US.schema.yml')
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
}) as any

export const inject = ['chatluna']

export const name = 'chatluna-openai-adapter'
