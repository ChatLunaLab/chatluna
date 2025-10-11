import { ChatLunaPlugin } from 'koishi-plugin-chatluna/services/chat'
import { Context, Logger, Schema } from 'koishi'
import { DouBaoClient } from './client'
import { createLogger } from 'koishi-plugin-chatluna/utils/logger'

export let logger: Logger

export function apply(ctx: Context, config: Config) {
    logger = createLogger(ctx, 'chatluna-doubao-adapter')

    ctx.on('ready', async () => {
        const plugin = new ChatLunaPlugin(ctx, config, 'doubao')

        plugin.parseConfig((config) => {
            return config.apiKeys
                .filter(([apiKey, _, enabled]) => {
                    return apiKey.length > 0 && enabled
                })
                .map(([apiKey, apiEndpoint]) => {
                    return {
                        apiKey,
                        apiEndpoint,
                        platform: 'doubao',
                        chatLimit: config.chatTimeLimit,
                        timeout: config.timeout,
                        maxRetries: config.maxRetries,
                        concurrentMaxSize: config.chatConcurrentMaxSize
                    }
                })
        })

        plugin.registerClient(() => new DouBaoClient(ctx, config, plugin))

        await plugin.initClient()
    })
}

export interface Config extends ChatLunaPlugin.Config {
    apiKeys: [string, string, boolean][]
    maxContextRatio: number
    temperature: number
    presencePenalty: number
    frequencyPenalty: number
}

export const Config: Schema<Config> = Schema.intersect([
    ChatLunaPlugin.Config,
    Schema.object({
        apiKeys: Schema.array(
            Schema.tuple([
                Schema.string().role('secret').default(''),
                Schema.string().default(
                    'https://ark.cn-beijing.volces.com/api/v3'
                ),
                Schema.boolean().default(true)
            ])
        )
            .default([[]])
            .role('table')
    }),
    Schema.object({
        maxContextRatio: Schema.number()
            .min(0)
            .max(1)
            .step(0.0001)
            .role('slider')
            .default(0.35),
        temperature: Schema.percent().min(0).max(2).step(0.1).default(1),
        presencePenalty: Schema.number().min(-2).max(2).step(0.1).default(0),
        frequencyPenalty: Schema.number().min(-2).max(2).step(0.1).default(0)
    })
]).i18n({
    'zh-CN': require('./locales/zh-CN.schema.yml'),
    'en-US': require('./locales/en-US.schema.yml')
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
}) as any

export const inject = ['chatluna']

export const name = 'chatluna-doubao-adapter'
