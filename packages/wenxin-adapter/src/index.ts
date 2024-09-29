import { ChatLunaPlugin } from 'koishi-plugin-chatluna/services/chat'
import { Context, Schema } from 'koishi'
import { WenxinClient } from './client'

export function apply(ctx: Context, config: Config) {
    const plugin = new ChatLunaPlugin(ctx, config, 'wenxin')

    ctx.on('ready', async () => {
        plugin.registerToService()

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

        plugin.registerClient(
            (_, clientConfig) =>
                new WenxinClient(ctx, config, clientConfig, plugin)
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
                Schema.string().role('secret').required(),
                Schema.string().role('secret').default('')
            ])
        ).default([['', '']])
    }),
    Schema.object({
        maxTokens: Schema.number().min(16).max(128000).step(16).default(1024),
        temperature: Schema.percent().min(0).max(1).step(0.1).default(0.8),
        presencePenalty: Schema.number()
            .min(1.0)
            .max(2.0)
            .step(0.1)
            .default(1.2),
        enableSearch: Schema.boolean().default(true)
    })
]).i18n({
    'zh-CN': require('./locales/zh-CN.schema.yml'),
    'en-US': require('./locales/en-US.schema.yml')
}) as Schema<Config>

export const inject = ['chatluna']

export const name = 'chatluna-wenxin-adapter'
