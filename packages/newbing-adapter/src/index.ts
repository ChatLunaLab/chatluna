import { ChatLunaPlugin } from 'koishi-plugin-chatluna/services/chat'
import { Context, Logger, Schema } from 'koishi'
import { BingClient } from './client'
import { BingClientConfig } from './types'
import { createLogger } from 'koishi-plugin-chatluna/utils/logger'

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
        plugin.registerToService()

        await plugin.parseConfig((config) => {
            return config.cookies.map((apiKey) => {
                return {
                    apiKey,
                    platform: 'bing',
                    chatLimit: config.chatTimeLimit,
                    timeout: config.timeout,
                    maxRetries: config.maxRetries,
                    concurrentMaxSize: config.chatConcurrentMaxSize,
                    sydney: config.sydney,
                    search: config.search
                }
            })
        })

        plugin.registerClient(
            (_, clientConfig) =>
                new BingClient(ctx, config, clientConfig, plugin)
        )

        await plugin.initClients()
    })
}

export interface Config extends ChatLunaPlugin.Config {
    cookies: string[]
    webSocketApiEndPoint: string
    createConversationApiEndPoint: string
    search: boolean
    sydney: boolean
}

export const Config: Schema<Config> = Schema.intersect([
    ChatLunaPlugin.Config,
    Schema.object({
        cookies: Schema.array(Schema.string().role('secret')).description(''),
        webSocketApiEndPoint: Schema.string().default(
            'wss://sydney.bing.com/sydney/ChatHub'
        ),
        createConversationApiEndPoint: Schema.string().default(
            'https://edgeservices.bing.com/edgesvc/turing/conversation/create'
        )
    }),
    Schema.object({
        sydney: Schema.boolean().default(false),
        search: Schema.boolean().default(true)
    })
]).i18n({
    'zh-CN': require('./locales/zh-CN.schema.yml'),
    'en-US': require('./locales/en-US.schema.yml')
})

export const inject = ['chatluna']

export const name = 'chatluna-newbing-adapter'
