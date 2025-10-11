import { ChatLunaPlugin } from 'koishi-plugin-chatluna/services/chat'
import { Context, Schema } from 'koishi'
import { QWenClient } from './client'
import { ModelCapabilities } from 'koishi-plugin-chatluna/llm-core/platform/types'

export function apply(ctx: Context, config: Config) {
    ctx.on('ready', async () => {
        const plugin = new ChatLunaPlugin(ctx, config, 'qwen')

        plugin.parseConfig((config) => {
            return config.apiKeys
                .filter(([apiKey, enabled]) => {
                    return apiKey.length > 0 && enabled
                })
                .map(([apiKey]) => {
                    return {
                        apiKey,
                        apiEndpoint: '',
                        platform: 'qwen',
                        chatLimit: config.chatTimeLimit,
                        timeout: config.timeout,
                        maxRetries: config.maxRetries,
                        concurrentMaxSize: config.chatConcurrentMaxSize
                    }
                })
        })

        plugin.registerClient(() => new QWenClient(ctx, config, plugin))

        await plugin.initClient()
    })
}

export interface Config extends ChatLunaPlugin.Config {
    apiKeys: [string, boolean][]
    enableSearch: boolean
    additionalModels: {
        model: string
        modelType: string
        contextSize: number
        modelCapabilities: ModelCapabilities[]
    }[]
    maxContextRatio: number
    temperature: number
}

export const Config: Schema<Config> = Schema.intersect([
    ChatLunaPlugin.Config,
    Schema.object({
        apiKeys: Schema.array(
            Schema.tuple([
                Schema.string().role('secret').default(''),
                Schema.boolean().default(true)
            ])
        )
            .default([[]])
            .role('table'),
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
        maxContextRatio: Schema.number()
            .min(0)
            .max(1)
            .step(0.0001)
            .role('slider')
            .default(0.35),
        temperature: Schema.percent().min(0).max(2).step(0.1).default(1),
        enableSearch: Schema.boolean().default(true)
    })
]).i18n({
    'zh-CN': require('./locales/zh-CN.schema.yml'),
    'en-US': require('./locales/en-US.schema.yml')
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
}) as any

export const inject = ['chatluna']

export const name = 'chatluna-qwen-adapter'
