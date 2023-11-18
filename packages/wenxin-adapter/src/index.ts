import { ChatLunaPlugin } from 'koishi-plugin-chatluna/lib/services/chat'
import { Context, Schema } from 'koishi'
import { WenxinClient } from './client'

export function apply(ctx: Context, config: Config) {
    const plugin = new ChatLunaPlugin(ctx, config, 'wenxin')

    ctx.on('ready', async () => {
        await plugin.registerToService()

        await plugin.parseConfig((config) => {
            return config.apiKeys.map(([apiKey, apiEndpoint]) => {
                return {
                    apiKey,
                    apiEndpoint,
                    platform: 'wenxin',
                    chatLimit: config.chatTimeLimit,
                    timeout: config.timeout,
                    maxRetries: config.maxRetries,
                    concurrentMaxSize: config.chatConcurrentMaxSize
                }
            })
        })

        await plugin.registerClient(
            (_, clientConfig) => new WenxinClient(ctx, config, clientConfig)
        )

        await plugin.initClients()
    })
}

export interface Config extends ChatLunaPlugin.Config {
    apiKeys: [string, string][]
    maxTokens: number
    temperature: number
    presencePenalty: number
    frequencyPenalty: number
    enableSearch: boolean
}

export const Config: Schema<Config> = Schema.intersect([
    ChatLunaPlugin.Config,
    Schema.object({
        apiKeys: Schema.array(
            Schema.tuple([
                Schema.string()
                    .role('secret')
                    .description('百度千帆大模型平台应用的 API Key')
                    .required(),
                Schema.string()
                    .role('secret')
                    .description('百度千帆大模型平台应用的 Secret Key')
                    .default('')
            ])
        )
            .description(
                '百度千帆大模型平台应用的鉴权参数列表(API Key, Secret Key)'
            )
            .default([['', '']])
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
            .description(
                '重复惩罚，越高越不易重复出现过至少一次的 Token（1~2，每步0.1）'
            )
            .min(1.0)
            .max(2.0)
            .step(0.1)
            .default(1.2),
        enableSearch: Schema.boolean()
            .description('是否启用模型自带搜索')
            .default(true)
    }).description('模型设置')
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
]) as any

export const inject = ['chatluna']

export const name = 'chatluna-wenxin-adapter'
