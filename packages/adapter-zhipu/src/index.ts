import { ChatLunaPlugin } from 'koishi-plugin-chatluna/services/chat'
import { Context, Logger, Schema } from 'koishi'
import { ZhipuClient } from './client'
import { ZhipuClientConfig } from './types'

export const logger = new Logger('chatluna-zhipu-adapter')

export function apply(ctx: Context, config: Config) {
    ctx.on('ready', async () => {
        const plugin = new ChatLunaPlugin(ctx, config, 'zhipu')

        plugin.parseConfig((config) => {
            return config.apiKeys
                .filter(([apiKey, enabled]) => {
                    return apiKey.length > 0 && enabled
                })
                .map(([apiKey, apiEndpoint]) => {
                    return {
                        apiKey,
                        apiEndpoint: '',
                        platform: 'zhipu',
                        chatLimit: config.chatTimeLimit,
                        timeout: config.timeout,
                        maxRetries: config.maxRetries,
                        concurrentMaxSize: config.chatConcurrentMaxSize,
                        webSearch: config.webSearch,
                        retrieval: config.retrieval
                            .filter((item) => item[1])
                            .map((item) => item[0])
                    } satisfies ZhipuClientConfig
                })
        })

        plugin.registerClient(() => new ZhipuClient(ctx, config, plugin))

        await plugin.initClient()
    })
}

export interface Config extends ChatLunaPlugin.Config {
    apiKeys: [string, boolean][]
    maxContextRatio: number
    temperature: number
    presencePenalty: number
    knowledgePromptTemplate: string
    frequencyPenalty: number
    retrieval: [string, boolean][]
    webSearch: boolean
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
        webSearch: Schema.boolean().default(false),
        retrieval: Schema.array(
            Schema.tuple([Schema.string(), Schema.boolean()])
        ).default([]),
        presencePenalty: Schema.number().min(-2).max(2).step(0.1).default(0),
        frequencyPenalty: Schema.number().min(-2).max(2).step(0.1).default(0),
        knowledgePromptTemplate: Schema.string()
            .role('textarea')
            .default(
                `从文档
            """
            {{knowledge}}
            """

            中找问题

            """
            {{question}}
            """

            的答案，找到答案就仅使用文档语句回答问题，找不到答案就用自身知识回答并且告诉用户该信息不是来自文档。
            不要复述问题，直接开始回答`
            )
    })
]).i18n({
    'zh-CN': require('./locales/zh-CN.schema.yml'),
    'en-US': require('./locales/en-US.schema.yml')
}) as Schema<Config>

export const inject = ['chatluna']

export const name = 'chatluna-zhipu-adapter'
