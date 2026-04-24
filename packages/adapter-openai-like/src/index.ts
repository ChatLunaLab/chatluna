import { Context, Logger, Schema } from 'koishi'
import { ChatLunaPlugin } from 'koishi-plugin-chatluna/services/chat'
import {
    ChatLunaError,
    ChatLunaErrorCode
} from 'koishi-plugin-chatluna/utils/error'
import { createLogger } from 'koishi-plugin-chatluna/utils/logger'
import { OpenAIClient } from './client'
import { ModelCapabilities } from 'koishi-plugin-chatluna/llm-core/platform/types'
import type { ResponseBuiltinToolName } from '@chatluna/v1-shared-adapter'

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
    blacklistModels: string[]
    additionCookies: [string, string][]
    maxContextRatio: number
    temperature: number
    presencePenalty: number
    platform: string
    frequencyPenalty: number
    nonStreaming: boolean
    responseApi: boolean
    googleSearch: boolean
    googleSearchSupportModel: string[]
    responseBuiltinTools: ResponseBuiltinToolName[]
    responseBuiltinToolSupportModel: string[]
    responseFileSearchVectorStoreIds: string[]
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
                        ModelCapabilities.TextInput,
                        ModelCapabilities.ToolCall,
                        ModelCapabilities.ImageInput,
                        ModelCapabilities.ImageGeneration
                    ])
                )
                    .default([
                        ModelCapabilities.TextInput,
                        ModelCapabilities.ToolCall
                    ])
                    .role('checkbox'),
                contextSize: Schema.number().default(128000)
            })
        )
            .default([])
            .role('table'),
        blacklistModels: Schema.array(Schema.string()).default([])
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
        nonStreaming: Schema.boolean().default(false),
        responseApi: Schema.boolean().default(false)
    }),
    Schema.object({
        googleSearch: Schema.boolean().default(false),
        googleSearchSupportModel: Schema.array(Schema.string()).default([
            'gemini-2.0'
        ]),
        responseBuiltinTools: Schema.array(
            Schema.union([
                'web_search',
                'web_search_preview',
                'image_generation',
                'code_interpreter',
                'file_search'
            ])
        )
            .default([])
            .role('checkbox'),
        responseBuiltinToolSupportModel: Schema.array(Schema.string()).default([
            'gpt-4o',
            'gpt-4o-mini',
            'gpt-4.1',
            'gpt-4.1-mini',
            'gpt-4.1-nano',
            'gpt-5',
            'gpt-5-mini',
            'gpt-5-nano',
            'o3',
            'o3-mini',
            'o4-mini'
        ]),
        responseFileSearchVectorStoreIds: Schema.array(Schema.string()).default(
            []
        )
    })
]).i18n({
    'zh-CN': require('./locales/zh-CN.schema.yml'),
    'en-US': require('./locales/en-US.schema.yml')
}) as Schema<Config>

export const usage = `
## OpenAI 兼容格式适配器说明

在 apiKeys 配置中填入你的 OpenAI 兼容格式 API Key 和 API 请求地址。

**如果你没有可用的 OpenAI 格式 API，请前往以下地址注册：**

[https://api.bltcy.ai/register](https://api.bltcy.ai/register?aff=ec5e312997)

完成后记得填写：
- API Key：从注册的账号中复制
- API 请求地址：\`https://api.bltcy.ai/v1\`
`

export const inject = {
    required: ['chatluna'],
    optional: ['chatluna_storage']
}

export const name = 'chatluna-openai-like-adapter'
