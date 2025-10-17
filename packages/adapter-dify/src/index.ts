import { ChatLunaPlugin } from 'koishi-plugin-chatluna/services/chat'
import { Context, Schema } from 'koishi'
import { DifyClientConfig } from './types'
import { DifyClient } from './client'

export function apply(ctx: Context, config: Config) {
    ctx.on('ready', async () => {
        const plugin = new ChatLunaPlugin<DifyClientConfig, Config>(
            ctx,
            config,
            'dify'
        )

        plugin.parseConfig((config) => {
            return [
                {
                    apiKey: '',
                    apiEndpoint: config.apiURL,
                    platform: 'dify',
                    chatLimit: config.chatTimeLimit,
                    timeout: config.timeout,
                    maxRetries: config.maxRetries,
                    concurrentMaxSize: config.chatConcurrentMaxSize,
                    // mark as Map<string,...>
                    additionalModel: new Map(
                        config.additionalModels
                            .filter((model) => model.enabled)
                            .map((model) => [model.workflowName, model])
                    )
                }
            ]
        })

        plugin.registerClient(() => new DifyClient(ctx, config, plugin))

        await plugin.initClient()
    })
}

export interface Config extends ChatLunaPlugin.Config {
    apiURL: string

    additionalModels: {
        apiKey: string
        workflowName: string
        workflowType: string
        enabled: boolean
    }[]
    maxContextRatio: number
    temperature: number
}

export const Config: Schema<Config> = Schema.intersect([
    ChatLunaPlugin.Config,
    Schema.object({
        apiURL: Schema.string().required(),
        additionalModels: Schema.array(
            Schema.object({
                apiKey: Schema.string().role('secret').default(''),
                workflowName: Schema.string(),
                workflowType: Schema.union([
                    'Agent',
                    'Workflow',
                    'ChatBot'
                ]).default('ChatBot'),
                enabled: Schema.boolean().default(true)
            }).role('table')
        ).default([])
    }),
    Schema.object({
        maxContextRatio: Schema.number()
            .min(0)
            .max(1)
            .step(0.0001)
            .role('slider')
            .default(0.35),
        temperature: Schema.percent().min(0).max(2).step(0.1).default(1)
    })
]).i18n({
    'zh-CN': require('./locales/zh-CN.schema.yml'),
    'en-US': require('./locales/en-US.schema.yml')
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
}) as any

export const inject = ['chatluna', 'database']

export const name = 'chatluna-dify-adapter'
