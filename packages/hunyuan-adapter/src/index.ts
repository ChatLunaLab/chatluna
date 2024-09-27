import { ChatLunaPlugin } from 'koishi-plugin-chatluna/services/chat'
import { Context, Schema } from 'koishi'
import { HunyuanClient } from './client'

export function apply(ctx: Context, config: Config) {
    const plugin = new ChatLunaPlugin(ctx, config, 'Hunyuan')

    ctx.on('ready', async () => {
        await plugin.registerToService()

        await plugin.parseConfig((config) => {
            return config.apiKeys.map((apiKey) => {
                return {
                    apiKey,
                    apiEndpoint: '',
                    platform: 'hunyuan',
                    chatLimit: config.chatTimeLimit,
                    timeout: config.timeout,
                    maxRetries: config.maxRetries,
                    concurrentMaxSize: config.chatConcurrentMaxSize
                }
            })
        })

        await plugin.registerClient(
            (_, clientConfig) =>
                new HunyuanClient(ctx, config, clientConfig, plugin)
        )

        await plugin.initClients()
    })
}

export interface Config extends ChatLunaPlugin.Config {
    apiKeys: string[]
    enableSearch: string
    additionalModels: {
        model: string
        modelType: string
        contextSize: number
    }[]
    maxTokens: number
    temperature: number
}

export const Config: Schema<Config> = Schema.intersect([
    ChatLunaPlugin.Config,
    Schema.object({
        apiKeys: Schema.array(
            Schema.string()
                .role('secret')
                .description('混元大模型的 API Key')
                .required()
        )
            .description('混元大模型的 API Key 列表')
            .default([''])
    }).description('请求设置'),

    Schema.object({
        maxTokens: Schema.number()
            .description(
                '回复的最大 Token 数（16~128000，必须是16的倍数）（注意如果你目前使用的模型的最大 Token 为 4000 及以上的话才建议设置超过 512 token）'
            )
            .min(16)
            .max(128000)
            .step(16)
            .default(4096),
        temperature: Schema.percent()
            .description('回复温度，越高越随机')
            .min(0)
            .max(1)
            .step(0.1)
            .default(0.8),

        enableSearch: Schema.boolean()
            .description('是否启用模型自带搜索')
            .default(true)
    }).description('模型设置')
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
]) as any

export const inject = ['chatluna']

export const name = 'chatluna-Hunyuan-adapter'
