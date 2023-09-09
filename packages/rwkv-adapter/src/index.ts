import { createLogger } from '@dingyi222666/koishi-plugin-chathub/lib/utils/logger'
import { ChatHubPlugin } from '@dingyi222666/koishi-plugin-chathub/lib/services/chat'
import { Context, Schema } from 'koishi'
import { RWKVClient } from './client'

const logger = createLogger()

export function apply(ctx: Context, config: Config) {
    const plugin = new ChatHubPlugin(ctx, config, 'rwkv')

    ctx.on('ready', async () => {
        await plugin.registerToService()

        await plugin.parseConfig((config) => {
            return config.apiKeys.map(([apiKey, apiEndpoint]) => {
                return {
                    apiKey,
                    apiEndpoint,
                    platform: 'rwkv',
                    chatLimit: config.chatTimeLimit,
                    timeout: config.timeout,
                    maxRetries: config.maxRetries,
                    concurrentMaxSize: config.chatConcurrentMaxSize
                }
            })
        })

        await plugin.registerClient((_, clientConfig) => new RWKVClient(ctx, config, clientConfig))

        await plugin.initClients()
    })
}

export interface Config extends ChatHubPlugin.Config {
    apiKeys: [string, string][]
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
                Schema.string().role('secret').description('RWKV Runner 设置的 API Key'),
                Schema.string().description('RWKV Runner 的 API 地址').default('https://127.0.0.1:8000')
            ])
        )
            .description('RWKV Runner API 的 API Key 和请求地址列表')
            .default([['', 'https://127.0.0.1:8000']])
    }).description('请求设置'),

    Schema.object({
        maxTokens: Schema.number()
            .description('回复的最大 Token 数（16~4096，必须是16的倍数）（注意如果你目前使用的模型的最大 Token 为 8000 及以上的话才建议设置超过 512 token）')
            .min(16)
            .max(4096)
            .step(16)
            .default(1024),
        temperature: Schema.percent().description('回复温度，越高越随机').min(0).max(1).step(0.1).default(0.8),
        presencePenalty: Schema.number().description('重复惩罚，越高越不易重复出现过至少一次的 Token（-2~2，每步0.1）').min(-2).max(2).step(0.1).default(0.2),
        frequencyPenalty: Schema.number().description('频率惩罚，越高越不易重复出现次数较多的 Token（-2~2，每步0.1）').min(-2).max(2).step(0.1).default(0.2)
    }).description('模型设置')
]) as any

export const using = ['chathub']

export const name = '@dingyi222666/chathub-rwkv-adapter'
