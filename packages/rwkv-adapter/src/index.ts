import { ChatLunaPlugin } from 'koishi-plugin-chatluna/services/chat'
import { Context, Schema } from 'koishi'
import { RWKVClient } from './client'

export function apply(ctx: Context, config: Config) {
    const plugin = new ChatLunaPlugin(ctx, config, 'rwkv')

    ctx.on('ready', async () => {
        plugin.parseConfig((config) => {
            return config.apiKeys.map(([apiKey, apiEndpoint]) => {
                return {
                    apiKey,
                    apiEndpoint,
                    platform: 'rwkv',
                    chatLimit: config.chatTimeLimit,
                    timeout: config.timeout,
                    maxRetries: config.maxRetries,
                    concurrentMaxSize: config.chatConcurrentMaxSize
                }
            })
        })

        plugin.registerClient((ctx) => new RWKVClient(ctx, config, plugin))

        await plugin.initClients()
    })
}

export interface Config extends ChatLunaPlugin.Config {
    apiKeys: [string, string][]
    maxTokens: number
    temperature: number
    presencePenalty: number
    frequencyPenalty: number
}

export const Config: Schema<Config> = Schema.intersect([
    ChatLunaPlugin.Config,
    Schema.object({
        apiKeys: Schema.array(
            Schema.tuple([
                Schema.string().role('secret'),
                Schema.string().default('http://127.0.0.1:8000')
            ])
        ).default([['', 'http://127.0.0.1:8000']])
    }),
    Schema.object({
        maxTokens: Schema.number().min(16).max(4096).step(16).default(4096),
        temperature: Schema.percent().min(0).max(2).step(0.1).default(1),
        presencePenalty: Schema.number().min(-2).max(2).step(0.1).default(0),
        frequencyPenalty: Schema.number().min(-2).max(2).step(0.1).default(0)
    })
]).i18n({
    'zh-CN': require('./locales/zh-CN.schema.yml'),
    'en-US': require('./locales/en-US.schema.yml')
}) as Schema<Config>

export const inject = ['chatluna']

export const name = 'chatluna-rmkv-adapter'
