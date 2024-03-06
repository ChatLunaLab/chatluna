import { Context, Schema } from 'koishi'
import { ChatLunaPlugin } from 'koishi-plugin-chatluna/lib/services/chat'
import { OllamaClient } from './client'

export function apply(ctx: Context, config: Config) {
    const plugin = new ChatLunaPlugin(ctx, config, 'ollama')

    ctx.on('ready', async () => {
        await plugin.registerToService()

        await plugin.parseConfig((config) => {
            return config.apiEndpoints.map((apiEndpoint) => {
                return {
                    apiKey: '',
                    apiEndpoint,
                    platform: 'ollama',
                    chatLimit: config.chatTimeLimit,
                    timeout: config.timeout,
                    maxRetries: config.maxRetries,
                    concurrentMaxSize: config.chatConcurrentMaxSize
                }
            })
        })

        await plugin.registerClient(
            (_, clientConfig) => new OllamaClient(ctx, config, clientConfig)
        )

        await plugin.initClients()
    })
}

export interface Config extends ChatLunaPlugin.Config {
    apiEndpoints: string[]
    maxTokens: number
    temperature: number
    presencePenalty: number
    frequencyPenalty: number
}

export const Config: Schema<Config> = Schema.intersect([
    ChatLunaPlugin.Config,
    Schema.object({
        apiEndpoints: Schema.array(Schema.string())
            .description('Ollama 的请求地址列表')
            .default(['https://127.0.0.1:11434'])
    }).description('请求设置'),

    Schema.object({
        maxTokens: Schema.number()
            .description(
                '回复的最大 Token 数（16~4096，必须是16的倍数）（注意如果你目前使用的模型的最大 Token 为 8000 及以上的话才建议设置超过 512 token）'
            )
            .min(16)
            .max(4096)
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
                '重复惩罚，越高越不易重复出现过至少一次的 Token（-2~2，每步0.1）'
            )
            .min(-2)
            .max(2)
            .step(0.1)
            .default(0.2),
        frequencyPenalty: Schema.number()
            .description(
                '频率惩罚，越高越不易重复出现次数较多的 Token（-2~2，每步0.1）'
            )
            .min(-2)
            .max(2)
            .step(0.1)
            .default(0.2)
    }).description('模型设置')
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
]) as any

export const inject = ['chatluna']

export const name = 'chatluna-ollama-adapter'
