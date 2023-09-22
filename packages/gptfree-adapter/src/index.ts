import { ChatHubPlugin } from '@dingyi222666/koishi-plugin-chathub/lib/services/chat'
import { Context, Schema } from 'koishi'
import { GPTFreeClient } from './client'

export function apply(ctx: Context, config: Config) {
    const plugin = new ChatHubPlugin(ctx, config, 'gptfree')

    ctx.on('ready', async () => {
        await plugin.registerToService()

        await plugin.parseConfig((config) => {
            return config.apiEndPoints.map((apiEndpoint) => {
                return {
                    apiKey: '',
                    apiEndpoint,
                    platform: 'gptfree',
                    chatLimit: config.chatTimeLimit,
                    timeout: config.timeout,
                    maxRetries: config.maxRetries,
                    concurrentMaxSize: config.chatConcurrentMaxSize
                }
            })
        })

        await plugin.registerClient(
            (_, clientConfig) => new GPTFreeClient(ctx, config, clientConfig)
        )

        await plugin.initClients()
    })
}

export interface Config extends ChatHubPlugin.Config {
    apiEndPoints: string[]
}

export const Config: Schema<Config> = Schema.intersect([
    ChatHubPlugin.Config,
    Schema.object({
        apiEndPoints: Schema.array(
            Schema.string().default('http://127.0.0.1:3000')
        ).description('请求 GPTFree 自搭建后端的API 地址')
    }).description('请求设置')
])

export const using = ['chathub']

export const name = 'chathub-gptfree-adapter'
