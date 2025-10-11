import { ClientConfig } from 'koishi-plugin-chatluna/llm-core/platform/config'
import { ChatLunaPlugin } from 'koishi-plugin-chatluna/services/chat'
import { createLogger } from 'koishi-plugin-chatluna/utils/logger'
import { Context, Logger, Schema } from 'koishi'
import { ClaudeClient } from './client'

export let logger: Logger
export function apply(ctx: Context, config: Config) {
    logger = createLogger(ctx, 'chatluna-claude-adapter')

    ctx.on('ready', async () => {
        const plugin = new ChatLunaPlugin<ClientConfig, Config>(
            ctx,
            config,
            'claude'
        )

        plugin.parseConfig((config) =>
            config.apiKeys
                .filter(([apiKey, _, enabled]) => {
                    return apiKey.length > 0 && enabled
                })
                .map((apiKey) => {
                    return {
                        apiKey: apiKey[0],
                        apiEndpoint: apiKey[1],
                        platform: 'claude',
                        chatLimit: config.chatTimeLimit,
                        timeout: config.timeout,
                        maxRetries: config.maxRetries,
                        concurrentMaxSize: config.chatConcurrentMaxSize
                    }
                })
        )

        plugin.registerClient(() => new ClaudeClient(ctx, config, plugin))

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
                Schema.string().default('https://api.anthropic.com/v1'),
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

export const name = 'chatluna-claude-adapter'
