/* eslint-disable @typescript-eslint/naming-convention */
import { Context, Logger, Schema } from 'koishi'
import { ClientConfig } from 'koishi-plugin-chatluna/llm-core/platform/config'
import { PlatformService } from 'koishi-plugin-chatluna/llm-core/platform/service'
import { ChatLunaPlugin } from 'koishi-plugin-chatluna/services/chat'
import { createLogger } from 'koishi-plugin-chatluna/utils/logger'
import { ChatLunaBrowsingChain } from './chain/browsing_chain'
import { PuppeteerBrowserTool } from './tools/puppeteerBrowserTool'
import { apply as configApply } from './config'
import { parseRawModelName } from 'koishi-plugin-chatluna/llm-core/utils/count_tokens'
import { ChatLunaChatModel } from 'koishi-plugin-chatluna/llm-core/platform/model'
import { SearchManager } from './provide'
import { providerPlugin } from './plugin'
import { SearchTool } from './tools/search'
export let logger: Logger

export function apply(ctx: Context, config: Config) {
    logger = createLogger(ctx, 'chatluna-search-service')
    const plugin = new ChatLunaPlugin<ClientConfig, Config>(
        ctx,
        config,
        'search-service',
        false
    )

    ctx.on('ready', async () => {
        plugin.registerToService()

        const summaryModel = config.enhancedSummary
            ? await createModel(ctx, config.summaryModel)
            : undefined

        // TODO: Use reranker or vectorstore to rank the results
        const searchManager = new SearchManager(ctx, config, plugin)

        providerPlugin(ctx, config, plugin, searchManager)

        plugin.registerTool('web-search', {
            async createTool(params, session) {
                return new SearchTool(searchManager)
            },
            selector() {
                return true
            }
        })

        plugin.registerTool('web-browser', {
            async createTool(params, session) {
                return new PuppeteerBrowserTool(
                    ctx,
                    summaryModel ?? params.model,
                    params.embeddings
                )
            },
            selector() {
                return true
            }
        })

        plugin.registerChatChainProvider(
            'browsing',
            {
                'zh-CN': '浏览模式，可以从外部获取信息',
                'en-US': 'Browsing mode, can get information from web'
            },
            async (params) => {
                const tools = getTools(
                    ctx.chatluna.platform,
                    (name) =>
                        name === 'web-search' ||
                        name === 'web-browser' ||
                        name === 'puppeteer_browser'
                )

                const model = params.model
                const options = {
                    preset: params.preset,
                    botName: params.botName,
                    embeddings: params.embeddings,
                    historyMemory: params.historyMemory,
                    enhancedSummary: config.enhancedSummary,
                    summaryModel: summaryModel ?? params.model,
                    thoughtMessage: ctx.chatluna.config.showThoughtMessage
                }

                return ChatLunaBrowsingChain.fromLLMAndTools(
                    model,
                    tools,
                    options
                )
            }
        )
    })

    configApply(ctx, config)
}

function getTools(service: PlatformService, filter: (name: string) => boolean) {
    const tools = service.getTools().filter(filter)

    return tools.map((name) => ({
        name,
        tool: service.getTool(name)
    }))
}

export async function createModel(ctx: Context, model: string) {
    const [platform, modelName] = parseRawModelName(model)
    await ctx.chatluna.awaitLoadPlatform(platform)
    return ctx.chatluna.createChatModel(
        platform,
        modelName
    ) as Promise<ChatLunaChatModel>
}

export interface Config extends ChatLunaPlugin.Config {
    searchEngine: string[]
    topK: number
    enhancedSummary: boolean
    summaryModel: string

    serperApiKey: string
    serperCountry: string
    serperLocation: string
    serperSearchResults: number

    bingSearchApiKey: string
    bingSearchLocation: string
    azureLocation: string

    wikipediaBaseURL: string[]
    maxWikipediaDocContentLength: number

    tavilyApiKey: string

    puppeteerTimeout: number
    puppeteerIdleTimeout: number
}

export const Config: Schema<Config> = Schema.intersect([
    ChatLunaPlugin.Config,

    Schema.object({
        searchEngine: Schema.array(
            Schema.union([
                Schema.const('bing-web').description('Bing (Web)'),
                Schema.const('bing-api').description('Bing (API)'),
                Schema.const('duckduckgo-lite').description(
                    'DuckDuckGo (Lite)'
                ),
                Schema.const('serper').description('Serper (Google)'),
                Schema.const('tavily').description('Tavily (API)'),
                Schema.const('google-web').description('Google (Web)'),
                Schema.const('wikipedia').description('Wikipedia')
            ])
        )
            .default(['bing-web'])
            .role('select'),
        topK: Schema.number().min(2).max(20).step(1).default(5),
        enhancedSummary: Schema.boolean().default(false),
        puppeteerTimeout: Schema.number().default(60000),
        puppeteerIdleTimeout: Schema.number().default(300000),
        summaryModel: Schema.dynamic('model')
    }),

    Schema.object({
        serperApiKey: Schema.string().role('secret'),
        serperCountry: Schema.string().default('cn'),
        serperLocation: Schema.string().default('zh-cn'),
        serperSearchResults: Schema.number().min(2).max(20).default(10)
    }),

    Schema.object({
        bingSearchApiKey: Schema.string().role('secret'),
        bingSearchLocation: Schema.string().default('zh-CN'),
        azureLocation: Schema.string().default('global')
    }),

    Schema.object({
        tavilyApiKey: Schema.string().role('secret')
    }),

    Schema.object({
        wikipediaBaseURL: Schema.array(Schema.string()).default([
            'https://en.wikipedia.org/w/api.php',
            'https://mzh.moegirl.org.cn/api.php'
        ]),
        maxWikipediaDocContentLength: Schema.number().default(5000)
    })
]).i18n({
    'zh-CN': require('./locales/zh-CN.schema.yml'),
    'en-US': require('./locales/en-US.schema.yml')
}) as Schema<Config>

export const inject = ['chatluna', 'puppeteer']

export const name = 'chatluna-search-service'
