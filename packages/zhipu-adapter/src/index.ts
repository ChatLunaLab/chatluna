import { ChatLunaPlugin } from 'koishi-plugin-chatluna/services/chat'
import { Context, Schema } from 'koishi'
import { ZhipuClient } from './client'
import { ZhipuClientConfig } from './types'

export function apply(ctx: Context, config: Config) {
    const plugin = new ChatLunaPlugin<ZhipuClientConfig, Config>(
        ctx,
        config,
        'zhipu'
    )

    ctx.on('ready', async () => {
        await plugin.registerToService()

        await plugin.parseConfig((config) => {
            return config.apiKeys.map((apiKey) => {
                return {
                    apiKey,
                    apiEndpoint: '',
                    platform: 'zhipu',
                    chatLimit: config.chatTimeLimit,
                    timeout: config.timeout,
                    maxRetries: config.maxRetries,
                    concurrentMaxSize: config.chatConcurrentMaxSize,
                    webSearch: config.webSearch,
                    codeInterpreter: config.codeInterpreter,
                    retrieval: config.retrieval
                        .filter((item) => item[1])
                        .map((item) => item[0])
                } satisfies ZhipuClientConfig
            })
        })

        await plugin.registerClient(
            (_, clientConfig) =>
                new ZhipuClient(ctx, config, clientConfig, plugin)
        )

        await plugin.initClients()
    })
}

export interface Config extends ChatLunaPlugin.Config {
    apiKeys: string[]
    maxTokens: number
    temperature: number
    presencePenalty: number
    knowledgePromptTemplate: string
    frequencyPenalty: number
    retrieval: [string, boolean][]
    codeInterpreter: boolean
    webSearch: boolean
}

export const Config: Schema<Config> = Schema.intersect([
    ChatLunaPlugin.Config,
    Schema.object({
        apiKeys: Schema.array(
            Schema.string()
                .role('secret')
                .description('智谱平台的 API Key')
                .required()
        ).description('智谱平台的 API Key 列表')
    }).description('请求设置'),

    Schema.object({
        maxTokens: Schema.number()
            .description(
                '回复的最大 Token 数（16~1024000，必须是16的倍数）（注意如果你目前使用的模型的最大 Token 为 32k 及以上的话才建议设置超过 8000 token）'
            )
            .min(16)
            .max(1024000)
            .step(16)
            .default(4096),
        temperature: Schema.percent()
            .description('回复温度，越高越随机')
            .min(0)
            .max(1)
            .step(0.1)
            .default(0.8),
        webSearch: Schema.boolean()
            .description('是否启用 Web 搜索')
            .default(true),
        retrieval: Schema.array(
            Schema.tuple([
                Schema.string().description('知识库 ID'),
                Schema.boolean().description('是否启用')
            ])
        )
            .description(
                '是否启用智谱知识库（左边填写知识库 ID，右边开关控制启用）'
            )
            .default([]),
      /*   codeInterpreter: Schema.boolean()
            .description(
                '是否启用 Code Interpreter，只支持 GLM-4-AllTools 模型'
            )
            .default(false), */
        knowledgePromptTemplate: Schema.string()
            .description('知识库查询模板')
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
            ),
        presencePenalty: Schema.number()
            .description(
                '重复惩罚，越高越不易重复出现过至少一次的 Token（-2~2，每步0.1）'
            )
            .min(-2)
            .max(2)
            .step(0.1)
            .default(0.2),
        frequencyPenalty: Schema.number()
            .description(
                '频率惩罚，越高越不易重复出现次数较多的 Token（-2~2，每步0.1）'
            )
            .min(-2)
            .max(2)
            .step(0.1)
            .default(0.2)
    }).description('模型设置')
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
]) as any

export const inject = ['chatluna']

export const name = 'chatluna-zhipu-adapter'
