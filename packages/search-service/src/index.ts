import { Tool } from '@langchain/core/tools'
import { Context, Logger, Schema } from 'koishi'
import { ClientConfig } from 'koishi-plugin-chatluna/llm-core/platform/config'
import { PlatformService } from 'koishi-plugin-chatluna/llm-core/platform/service'
import { ChatHubTool } from 'koishi-plugin-chatluna/llm-core/platform/types'
import { ChatLunaPlugin } from 'koishi-plugin-chatluna/services/chat'
import { createLogger } from 'koishi-plugin-chatluna/utils/logger'
import { ChatLunaBrowsingChain } from './chain/browsing_chain'
import SerperSearchTool from './tools/serper'
import BingAISearchTool from './tools/bing-api'
import DuckDuckGoSearchTool from './tools/duckduckgo-lite'
import { PuppeteerBrowserTool } from './tools/puppeteerBrowserTool'

export let logger: Logger

export function apply(ctx: Context, config: Config) {
    logger = createLogger(ctx, 'chatluna-search-service')
    const plugin = new ChatLunaPlugin<ClientConfig, Config>(
        ctx,
        config,
        'search-service',
        false
    )

    const adapters: Record<
        string,
        | typeof BingAISearchTool
        | typeof DuckDuckGoSearchTool
        | typeof SerperSearchTool
    > = {
        'bing-api': BingAISearchTool,
        'duckduckgo-lite': DuckDuckGoSearchTool,
        serper: SerperSearchTool
    }

    ctx.on('ready', async () => {
        await plugin.registerToService()

        await plugin.registerTool('web-search', {
            async createTool(params, session) {
                const targetAdapter = config.searchEngine

                // eslint-disable-next-line new-cap
                return new adapters[targetAdapter](
                    config,
                    new PuppeteerBrowserTool(
                        ctx,
                        params.model,
                        params.embeddings
                    ),
                    plugin
                )
            },
            selector() {
                return true
            }
        })

        await plugin.registerTool('web-browser', {
            async createTool(params, session) {
                return new PuppeteerBrowserTool(
                    ctx,
                    params.model,
                    params.embeddings
                )
            },
            selector() {
                return true
            }
        })

        await plugin.registerChatChainProvider(
            'browsing',
            'Browsing 模式，可以从外部获取信息',
            async (params) => {
                const tools = await Promise.all(
                    getTools(
                        ctx.chatluna.platform,
                        (name) =>
                            name === 'web-search' ||
                            name === 'web-browser' ||
                            name === 'puppeteer-browser'
                    ).map((tool) =>
                        tool.createTool({
                            model: params.model,
                            embeddings: params.embeddings
                        })
                    )
                )

                const model = params.model
                const options = {
                    systemPrompts: params.systemPrompt,
                    botName: params.botName,
                    embeddings: params.embeddings,
                    historyMemory: params.historyMemory,
                    longMemory: params.longMemory,
                    enhancedSummary: config.enhancedSummary
                }

                return ChatLunaBrowsingChain.fromLLMAndTools(
                    model,
                    // only select web-search
                    tools as Tool[],
                    options
                )
            }
        )
    })
}

function getTools(
    service: PlatformService,
    filter: (name: string) => boolean
): ChatHubTool[] {
    const tools = service.getTools().filter(filter)

    return tools.map((name) => service.getTool(name))
}

export interface Config extends ChatLunaPlugin.Config {
    searchEngine: string
    topK: number
    enhancedSummary: boolean

    serperApiKey: string
    serperCountry: string
    serperLocation: string
    serperSearchResults: number

    bingSearchApiKey: string
    bingSearchLocation: string
    azureLocation: string

    puppeteerTimeout: number
    puppeteerIdleTimeout: number
}

export const Config: Schema<Config> = Schema.intersect([
    Schema.object({
        searchEngine: Schema.union([
            Schema.const('duckduckgo-lite'),
            Schema.const('serper'),
            Schema.const('bing-api')
        ]).default('duckduckgo-lite'),
        topK: Schema.number().min(2).max(20).step(1).default(5),
        enhancedSummary: Schema.boolean().default(false),
        puppeteerTimeout: Schema.number().default(60000),
        puppeteerIdleTimeout: Schema.number().default(300000)
    }),

    Schema.union([
        Schema.object({
            searchEngine: Schema.const('serper').required(),
            serperApiKey: Schema.string().role('secret').required(),
            serperCountry: Schema.string().default('cn'),
            serperLocation: Schema.string().default('zh-cn'),
            serperSearchResults: Schema.number().min(2).max(20).default(10)
        }),
        Schema.object({
            searchEngine: Schema.const('bing-api').required(),
            bingSearchApiKey: Schema.string().role('secret').required(),
            bingSearchLocation: Schema.string().default('zh-CN'),
            azureLocation: Schema.string().default('global')
        }),
        Schema.object({})
    ])
]).i18n({
    'zh-CN': require('./locales/zh-CN.schema.yml'),
    'en-US': require('./locales/en-US.schema.yml')
}) as Schema<Config>

export const inject = ['chatluna', 'puppeteer']

export const name = 'chatluna-search-service'
