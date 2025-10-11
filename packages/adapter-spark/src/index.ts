import { Context, Schema } from 'koishi'
import { ChatLunaPlugin } from 'koishi-plugin-chatluna/services/chat'
import { SparkClient } from './client'
import { SparkClientConfig } from './types'

export function apply(ctx: Context, config: Config) {
    ctx.on('ready', async () => {
        const plugin = new ChatLunaPlugin<SparkClientConfig, Config>(
            ctx,
            config,
            'spark'
        )

        plugin.parseConfig((config) => {
            return config.appConfigs
                .filter((apiKeys) => apiKeys.enabled !== false)
                .map((apiKeys) => {
                    return {
                        apiKey: undefined,
                        apiEndpoint: undefined,
                        platform: 'spark',
                        chatLimit: config.chatTimeLimit,
                        timeout: config.timeout,
                        maxRetries: config.maxRetries,
                        concurrentMaxSize: config.chatConcurrentMaxSize,
                        apiPasswords: apiKeys
                    }
                })
        })

        plugin.registerClient(() => new SparkClient(ctx, config, plugin))

        await plugin.initClient()
    })
}

export interface Config extends ChatLunaPlugin.Config {
    appConfigs: (Record<string, string> & { enabled?: boolean })[]
    maxContextRatio: number
    temperature: number
}

export const Config: Schema<Config> = Schema.intersect([
    ChatLunaPlugin.Config,
    Schema.object({
        appConfigs: Schema.array(Schema.dict(String).default({}).role('table'))

            .default([])
    }),
    Schema.object({
        maxContextRatio: Schema.number()
            .min(0)
            .max(1)
            .step(0.0001)
            .role('slider')
            .default(0.35),
        temperature: Schema.percent().min(0.1).max(1).step(0.01).default(1)
    })
]).i18n({
    'zh-CN': require('./locales/zh-CN.schema.yml'),
    'en-US': require('./locales/en-US.schema.yml')
}) as Schema<Config>

export const inject = ['chatluna']

export const name = 'chatluna-spark-adapter'
