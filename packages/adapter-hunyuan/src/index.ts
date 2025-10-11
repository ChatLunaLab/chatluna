import { ChatLunaPlugin } from 'koishi-plugin-chatluna/services/chat'
import { createLogger } from 'koishi-plugin-chatluna/utils/logger'
import { Context, Logger, Schema } from 'koishi'
import { HunyuanClient } from './client'

export let logger: Logger

export function apply(ctx: Context, config: Config) {
    logger = createLogger(ctx, 'chatluna-hunyuan-adapter')

    ctx.on('ready', async () => {
        const plugin = new ChatLunaPlugin(ctx, config, 'hunyuan')

        plugin.parseConfig((config) => {
            return config.apiKeys
                .filter(([apiKey, enabled]) => {
                    return apiKey.length > 0 && enabled
                })
                .map(([apiKey]) => {
                    return {
                        apiKey,
                        apiEndpoint: '',
                        platform: 'hunyuan',
                        chatLimit: config.chatTimeLimit,
                        timeout: config.timeout,
                        maxRetries: config.maxRetries,
                        concurrentMaxSize: config.chatConcurrentMaxSize
                    }
                })
        })

        plugin.registerClient(() => new HunyuanClient(ctx, config, plugin))

        await plugin.initClient()
    })
}

export interface Config extends ChatLunaPlugin.Config {
    apiKeys: [string, boolean][]
    enableSearch: boolean
    additionalModels: {
        model: string
        modelType: string
        contextSize: number
    }[]
    maxContextRatio: number
    temperature: number
}

export const Config: Schema<Config> = Schema.intersect([
    ChatLunaPlugin.Config,
    Schema.object({
        apiKeys: Schema.array(
            Schema.tuple([
                Schema.string().role('secret').default(''),
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
        enableSearch: Schema.boolean().default(true)
    })
]).i18n({
    'zh-CN': require('./locales/zh-CN.schema.yml'),
    'en-US': require('./locales/en-US.schema.yml')
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
}) as any

export const inject = ['chatluna']

export const name = 'chatluna-Hunyuan-adapter'
