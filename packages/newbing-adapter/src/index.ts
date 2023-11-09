import { ChatLunaPlugin } from 'koishi-plugin-chatluna/lib/services/chat'
import { Context, Logger, Schema } from 'koishi'
import { BingClient } from './client'
import { BingClientConfig } from './types'
import { createLogger } from 'koishi-plugin-chatluna/lib/utils/logger'

export let logger: Logger

export function apply(ctx: Context, config: Config) {
    config.chatConcurrentMaxSize = 0

    const plugin = new ChatLunaPlugin<BingClientConfig, Config>(
        ctx,
        config,
        'bing'
    )

    logger = createLogger(ctx, 'chatluna-newbing-adapter')

    ctx.on('ready', async () => {
        await plugin.registerToService()

        await plugin.parseConfig((config) => {
            return config.cookies.map((apiKey) => {
                return {
                    apiKey,
                    platform: 'bing',
                    chatLimit: config.chatTimeLimit,
                    timeout: config.timeout,
                    maxRetries: config.maxRetries,
                    concurrentMaxSize: config.chatConcurrentMaxSize,
                    sydney: config.sydney
                }
            })
        })

        await plugin.registerClient(
            (_, clientConfig) => new BingClient(ctx, config, clientConfig)
        )

        await plugin.initClients()
    })
}

export interface Config extends ChatLunaPlugin.Config {
    cookies: string[]

    webSocketApiEndPoint: string
    createConversationApiEndPoint: string

    sydney: boolean
}

export const Config: Schema<Config> = Schema.intersect([
    ChatLunaPlugin.Config,

    Schema.object({
        cookies: Schema.array(
            Schema.string().role('secret').required()
        ).description('Bing 账号的 Cookie'),
        webSocketApiEndPoint: Schema.string()
            .description('New Bing 的 WebSocket API EndPoint')
            .default('wss://sydney.bing.com/sydney/ChatHub'),
        createConversationApiEndPoint: Schema.string()
            .description('New Bing 的 新建会话 API EndPoint')
            .default(
                'https://edgeservices.bing.com/edgesvc/turing/conversation/create'
            )
    }).description('请求设置'),

    Schema.object({
        sydney: Schema.boolean()
            .description(
                '是否开启 Sydney 模式（破解对话20次回复数限制，账号可能会有风险）'
            )
            .default(false)
    }).description('对话设置')
])

export const inject = ['chatluna']

export const name = 'chatluna-newbing-adapter'
