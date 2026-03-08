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
    imageGeneration: boolean
    imageModelSearch: boolean
    thinkingBudget: number
    includeThoughts: boolean
    groundingContentDisplay: boolean
    useCamelCaseSystemInstruction: boolean
    nonStreaming: boolean
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
        imageModelSearch: Schema.boolean().default(false),
        groundingContentDisplay: Schema.boolean().default(false),
        imageGeneration: Schema.boolean().default(false),
        useCamelCaseSystemInstruction: Schema.boolean().default(false),
        nonStreaming: Schema.boolean().default(false)
    })
]).i18n({
    'zh-CN': require('./locales/zh-CN.schema.yml'),
    'en-US': require('./locales/en-US.schema.yml')
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
}) as any

export const usage = `
## Gemini 适配器说明

在 apiKeys 配置中填入你的 Gemini API Key 和 API 请求地址。

**如果你没有可用的 Gemini 格式 API，请前往以下地址注册：**

[https://api.bltcy.ai/register](https://api.bltcy.ai/register?aff=ec5e312997)

完成后记得填写：
- API Key：从注册的账号中复制
- API 请求地址：\`https://api.bltcy.ai/v1beta\`
`

export const inject = {
    required: ['chatluna'],
    optional: ['chatluna_storage']
}

export const name = 'chatluna-google-gemini-adapter'
