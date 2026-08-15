import { ChatLunaPlugin } from 'koishi-plugin-chatluna/services/chat'
import { Context, Logger, Schema } from 'koishi'
import { OpenAIClient } from './client'
import { createLogger } from 'koishi-plugin-chatluna/utils/logger'
import type { ResponseBuiltinToolName } from '@chatluna/v1-shared-adapter'

export let logger: Logger

export function apply(ctx: Context, config: Config) {
    logger = createLogger(ctx, 'chatluna-openai-adapter')

    ctx.on('ready', async () => {
        const plugin = new ChatLunaPlugin(ctx, config, 'openai')

        plugin.parseConfig((config) => {
            return config.apiKeys
                .filter(([apiKey, _, enabled]) => {
                    return apiKey.length > 0 && enabled
                })
                .map(([apiKey, apiEndpoint]) => {
                    return {
                        apiKey,
                        apiEndpoint,
                        platform: 'openai',
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
    maxContextRatio: number
    temperature: number
    presencePenalty: number
    frequencyPenalty: number
    responseApi: boolean
    responseBuiltinTools: ResponseBuiltinToolName[]
    responseBuiltinToolSupportModel: string[]
    responseFileSearchVectorStoreIds: string[]
}

export const Config: Schema<Config> = Schema.intersect([
    ChatLunaPlugin.Config,
    Schema.object({
        apiKeys: Schema.array(
            Schema.tuple([
                Schema.string().role('secret').default(''),
                Schema.string().default('https://api.openai.com/v1'),
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
        presencePenalty: Schema.number().min(-2).max(2).step(0.1).default(0),
        frequencyPenalty: Schema.number().min(-2).max(2).step(0.1).default(0),
        responseApi: Schema.boolean().default(false)
    }),
    Schema.object({
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
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
}) as any

export const usage = `
## OpenAI 适配器说明

在 apiKeys 配置中填入你的 OpenAI API Key 和 API 请求地址。

**如果你没有可用的 OpenAI 格式 API，请前往以下地址注册：**

[https://moyuu.cc/register?aff=vhqh](https://moyuu.cc/register?aff=vhqh)

完成后记得填写：
- API Key：从注册的账号中复制
- API 请求地址：\`https://moyuu.cc/v1\`
`

export const inject = {
    required: ['chatluna'],
    optional: ['chatluna_storage']
}

export const name = 'chatluna-openai-adapter'
