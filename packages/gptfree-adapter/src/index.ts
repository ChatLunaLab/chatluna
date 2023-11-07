import { ChatLunaPlugin } from 'koishi-plugin-chatluna/lib/services/chat'
import { Context, Schema } from 'koishi'
import { GPTFreeClient } from './client'

export function apply(ctx: Context, config: Config) {
    const plugin = new ChatLunaPlugin(ctx, config, 'gptfree')

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

export interface Config extends ChatLunaPlugin.Config {
    apiEndPoints: string[]
}

export const Config: Schema<Config> = Schema.intersect([
    ChatLunaPlugin.Config,
    Schema.object({
        apiEndPoints: Schema.array(
            Schema.string().default('http://127.0.0.1:3000')
        ).description('请求 GPTFree 自搭建后端的API 地址')
    }).description('请求设置')
])

export const inject = ['chathub']

export const name = 'chatluna-gptfree-adapter'
