import { ChatHubPlugin } from '@dingyi222666/koishi-plugin-chathub/lib/services/chat'
import { Context, Schema } from 'koishi'
import { OpenLLMClient } from './client'

export function apply(ctx: Context, config: Config) {
    const plugin = new ChatHubPlugin(ctx, config, 'openllm')

    ctx.on('ready', async () => {
        await plugin.registerToService()

        await plugin.parseConfig((config) => {
            return config.apiKeys.map(([apiKey, apiEndpoint]) => {
                return {
                    apiKey,
                    apiEndpoint,
                    platform: 'openllm',
                    chatLimit: config.chatTimeLimit,
                    timeout: config.timeout,
                    maxRetries: config.maxRetries,
                    concurrentMaxSize: config.chatConcurrentMaxSize
                }
            })
        })

        await plugin.registerClient(
            (_, clientConfig) => new OpenLLMClient(ctx, config, clientConfig)
        )

        await plugin.initClients()
    })
}

export interface Config extends ChatHubPlugin.Config {
    apiKeys: [string, string][]
    embeddings: string
    maxTokens: number
    temperature: number
    presencePenalty: number
    frequencyPenalty: number
}

export const Config: Schema<Config> = Schema.intersect([
    ChatHubPlugin.Config,
    Schema.object({
        apiKeys: Schema.array(
            Schema.tuple([
                Schema.string().role('secret').default('').description('OpenAI 的 API Key'),
                Schema.string()
                    .description('请求 API for Open LLMs 自搭建后端的地址')
                    .default('http://127.0.0.1:8000')
            ])
        )
            .description('API for Open LLMs 服务的 API Key 和请求地址列表')
            .default([['', 'http://127.0.0.1:8000']]),
        embeddings: Schema.string().description('Embeddings 模型的名称').default('moka-ai/m3e-base')
    }).description('请求设置'),

    Schema.object({
        maxTokens: Schema.number()
            .description(
                '回复的最大 Token 数（16~8000，必须是16的倍数）（注意如果你目前使用的模型的最大 Token 为 8000 及以上的话才建议设置超过 512 token）'
            )
            .min(16)
            .max(8000)
            .step(16)
            .default(1024),
        temperature: Schema.percent()
            .description('回复温度，越高越随机')
            .min(0)
            .max(1)
            .step(0.1)
            .default(0.8),
        presencePenalty: Schema.number()
            .description('重复惩罚，越高越不易重复出现过至少一次的 Token（-2~2，每步0.1）')
            .min(-2)
            .max(2)
            .step(0.1)
            .default(0.2),
        frequencyPenalty: Schema.number()
            .description('频率惩罚，越高越不易重复出现次数较多的 Token（-2~2，每步0.1）')
            .min(-2)
            .max(2)
            .step(0.1)
            .default(0.2)
    }).description('模型设置')
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
]) as any

export const using = ['chathub']

export const name = 'chathub-chatglm-adapter'
