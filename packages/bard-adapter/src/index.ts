import { ChatLunaPlugin } from 'koishi-plugin-chatluna/services/chat'
import { Context, Schema } from 'koishi'

import { BardClient } from './client'

export function apply(ctx: Context, config: Config) {
    config.chatConcurrentMaxSize = 1

    const plugin = new ChatLunaPlugin(ctx, config, 'bard')

    ctx.on('ready', async () => {
        await plugin.registerToService()

        await plugin.parseConfig((config) =>
            config.cookies.map((apiKey) => {
                return {
                    apiKey,
                    platform: 'bard',
                    chatLimit: config.chatTimeLimit,
                    timeout: config.timeout,
                    maxRetries: config.maxRetries,
                    concurrentMaxSize: config.chatConcurrentMaxSize
                }
            })
        )

        await plugin.registerClient(
            (_, clientConfig) =>
                new BardClient(ctx, config, clientConfig, plugin)
        )

        await plugin.initClients()
    })
}

// export const usage = readFileSync(__dirname + '/../README.md', 'utf8')

export interface Config extends ChatLunaPlugin.Config {
    cookies: string[]
}

export const Config: Schema<Config> = Schema.intersect([
    ChatLunaPlugin.Config,

    Schema.object({
        cookies: Schema.array(
            Schema.string().role('secret').required()
        ).description('在 bard.google.com 登录后获取的 Cookie')
    }).description('请求设置')
])

export const inject = ['chatluna']

export const name = 'chatluna-bard-adapter'
