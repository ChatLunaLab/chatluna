import { Context, Logger, Schema } from 'koishi'
import { ChatLunaPlugin } from 'koishi-plugin-chatluna/services/chat'
import {
    ChatLunaError,
    ChatLunaErrorCode
} from 'koishi-plugin-chatluna/utils/error'
import { createLogger } from 'koishi-plugin-chatluna/utils/logger'
import { OpenAIClient } from './client'
import { ModelCapabilities } from 'koishi-plugin-chatluna/llm-core/platform/types'

export let logger: Logger
export const reusable = true

export function apply(ctx: Context, config: Config) {
    logger = createLogger(ctx, 'chatluna-openai-like-adapter')

    ctx.on('ready', async () => {
        if (config.platform == null || config.platform.length < 1) {
            throw new ChatLunaError(
                ChatLunaErrorCode.UNKNOWN_ERROR,
                new Error('Cannot find any platform')
            )
        }

        const platform = config.platform

        const plugin = new ChatLunaPlugin(ctx, config, platform)

        plugin.parseConfig((config) => {
            return config.apiKeys
                .filter(([apiKey, _, enabled]) => {
                    return apiKey.length > 0 && enabled
                })
                .map(([apiKey, apiEndpoint]) => {
                    return {
                        apiKey,
                        apiEndpoint,
                        platform,
                        chatLimit: config.chatTimeLimit,
                        timeout: config.timeout,
                        maxRetries: config.maxRetries,
                        concurrentMaxSize: config.chatConcurrentMaxSize
                    }
                })
        })

        plugin.registerClient(() => new OpenAIClient(ctx, config, plugin))

        await plugin.initClient()
    })
}

export interface Config extends ChatLunaPlugin.Config {
    apiKeys: [string, string, boolean][]
    pullModels: boolean
    additionalModels: {
        model: string
        modelType: string
        modelCapabilities: ModelCapabilities[]
        contextSize: number
    }[]
    additionCookies: [string, string][]
    maxContextRatio: number
    temperature: number
    presencePenalty: number
    platform: string
    frequencyPenalty: number
    nonStreaming: boolean
    googleSearch: boolean
    googleSearchSupportModel: string[]
}

export const Config: Schema<Config> = Schema.intersect([
    ChatLunaPlugin.Config,
    Schema.object({
        platform: Schema.string().default('openai-like'),
        pullModels: Schema.boolean().default(true),
        additionalModels: Schema.array(
            Schema.object({
                model: Schema.string(),
                modelType: Schema.union([
                    'LLM 大语言模型',
                    'Embeddings 嵌入模型'
                ]).default('LLM 大语言模型'),
                modelCapabilities: Schema.array(
                    Schema.union([
                        ModelCapabilities.ToolCall,
                        ModelCapabilities.ImageInput
                    ])
                )
                    .default([ModelCapabilities.ToolCall])
                    .role('checkbox'),
                contextSize: Schema.number().default(128000)
            })
        )
            .default([])
            .role('table')
    }),
    Schema.object({
        apiKeys: Schema.array(
            Schema.tuple([
                Schema.string().role('secret').default(''),
                Schema.string().default('https://api.openai.com/v1'),
                Schema.boolean().default(true)
            ])
        )
            .default([[]])
            .role('table'),
        additionCookies: Schema.array(
            Schema.tuple([Schema.string(), Schema.string()])
        ).default([])
    }),
    Schema.object({
        maxContextRatio: Schema.number()
            .min(0)
            .max(1)
            .step(0.0001)
            .role('slider')
            .default(0.35),
        temperature: Schema.percent().min(0).max(2).step(0.1).default(1),
        presencePenalty: Schema.number().min(-2).max(2).step(0.1).default(0),
        frequencyPenalty: Schema.number().min(-2).max(2).step(0.1).default(0),
        nonStreaming: Schema.boolean().default(false)
    }),
    Schema.object({
        googleSearch: Schema.boolean().default(false),
        googleSearchSupportModel: Schema.array(Schema.string()).default([
            'gemini-2.0'
        ])
    })
]).i18n({
    'zh-CN': require('./locales/zh-CN.schema.yml'),
    'en-US': require('./locales/en-US.schema.yml')
}) as Schema<Config>

export const inject = ['chatluna']

export const name = 'chatluna-openai-like-adapter'
