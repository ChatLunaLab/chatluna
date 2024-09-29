import { ChatLunaPlugin } from 'koishi-plugin-chatluna/services/chat'
import { Context, Schema } from 'koishi'
import { GPTFreeClient } from './client'

export function apply(ctx: Context, config: Config) {
    const plugin = new ChatLunaPlugin(ctx, config, 'gptfree')

    ctx.on('ready', async () => {
        plugin.registerToService()

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

        plugin.registerClient(
            (_, clientConfig) =>
                new GPTFreeClient(ctx, config, clientConfig, plugin)
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
        ).default(['http://127.0.0.1:3000'])
    })
]).i18n({
    'zh-CN': require('./locales/zh-CN.schema.yml'),
    'en-US': require('./locales/en-US.schema.yml')
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
}) as any

export const inject = ['chatluna']

export const name = 'chatluna-gptfree-adapter'
