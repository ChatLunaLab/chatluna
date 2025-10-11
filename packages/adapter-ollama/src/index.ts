import { Context, Logger, Schema } from 'koishi'
import { ChatLunaPlugin } from 'koishi-plugin-chatluna/services/chat'
import { createLogger } from 'koishi-plugin-chatluna/utils/logger'
import { OllamaClient } from './client'

export let logger: Logger

export function apply(ctx: Context, config: Config) {
    logger = createLogger(ctx, 'chatluna-ollama-adapter')

    ctx.on('ready', async () => {
        const plugin = new ChatLunaPlugin(ctx, config, 'ollama')

        plugin.parseConfig((config) => {
            return config.apiEndpoints
                .filter(([apiEndpoint, enabled]) => {
                    return apiEndpoint.length > 0 && enabled
                })
                .map(([apiEndpoint]) => {
                    return {
                        apiKey: '',
                        apiEndpoint,
                        platform: 'ollama',
                        chatLimit: config.chatTimeLimit,
                        timeout: config.timeout,
                        maxRetries: config.maxRetries,
                        concurrentMaxSize: config.chatConcurrentMaxSize
                    }
                })
        })

        plugin.registerClient(() => new OllamaClient(ctx, config, plugin))

        await plugin.initClient()
    })
}

export interface Config extends ChatLunaPlugin.Config {
    apiEndpoints: [string, boolean][]
    maxContextRatio: number
    temperature: number
    presencePenalty: number
    frequencyPenalty: number
    supportImageModels: string[]
    keepAlive: boolean
}

export const Config: Schema<Config> = Schema.intersect([
    ChatLunaPlugin.Config,
    Schema.object({
        apiEndpoints: Schema.array(
            Schema.tuple([Schema.string(), Schema.boolean().default(true)])
        )
            .default([['http://127.0.0.1:11434', true]])
            .role('table'),
        supportImageModels: Schema.array(Schema.string()).default(['gemma3']),
        keepAlive: Schema.boolean().default(true)
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
}) as Schema<Config>

export const inject = ['chatluna']

export const name = 'chatluna-ollama-adapter'
