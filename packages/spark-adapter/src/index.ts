import { Context, Schema } from 'koishi'
import { ChatLunaPlugin } from 'koishi-plugin-chatluna/services/chat'
import { SparkClient } from './client'
import { SparkClientConfig } from './types'

export function apply(ctx: Context, config: Config) {
    const plugin = new ChatLunaPlugin<SparkClientConfig, Config>(
        ctx,
        config,
        'spark'
    )

    ctx.on('ready', async () => {
        plugin.registerToService()

        await plugin.parseConfig((config) => {
            return config.appConfigs.map(([appId, apiSecret, apiKey]) => {
                return {
                    apiKey,
                    appId,
                    apiSecret,
                    apiEndpoint: undefined,
                    platform: 'spark',
                    chatLimit: config.chatTimeLimit,
                    timeout: config.timeout,
                    maxRetries: config.maxRetries,
                    concurrentMaxSize: config.chatConcurrentMaxSize
                }
            })
        })

        plugin.registerClient(
            (_, clientConfig) =>
                new SparkClient(ctx, config, clientConfig, plugin)
        )

        await plugin.initClients()
    })
}

export interface Config extends ChatLunaPlugin.Config {
    appConfigs: [string, string, string][]
    maxTokens: number
    temperature: number
    assistants: [string, string][]
}

export const Config: Schema<Config> = Schema.intersect([
    ChatLunaPlugin.Config,
    Schema.object({
        appConfigs: Schema.array(
            Schema.tuple([
                Schema.string().required(),
                Schema.string().role('secret').required(),
                Schema.string().role('secret').required()
            ])
        ).default([]),
        assistants: Schema.array(
            Schema.tuple([
                Schema.string().required(),
                Schema.string().role('secret').required()
            ])
        ).default([])
    }),
    Schema.object({
        maxTokens: Schema.number().min(16).max(12800).step(16).default(1024),
        temperature: Schema.percent().min(0.1).max(1).step(0.01).default(0.8)
    })
]).i18n({
    'zh-CN': require('./locales/zh-CN.schema.yml'),
    'en-US': require('./locales/en-US.schema.yml')
}) as Schema<Config>

export const inject = ['chatluna']

export const name = 'chatluna-spark-adapter'
