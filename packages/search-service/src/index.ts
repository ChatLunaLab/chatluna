import { ChatLunaPlugin } from 'koishi-plugin-chatluna/lib/services/chat'
import { Context, Logger, Schema } from 'koishi'
import { Tool } from 'langchain/tools'
import { WebBrowser } from './webbrowser'
import { ClientConfig } from 'koishi-plugin-chatluna/lib/llm-core/platform/config'
import { randomUA } from 'koishi-plugin-chatluna/lib/utils/request'
import { createLogger } from 'koishi-plugin-chatluna/lib/utils/logger'
import { fuzzyQuery } from 'koishi-plugin-chatluna/lib/utils/string'

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
        await plugin.registerTool('web-search', {
            async createTool(params, session) {
                const targetAdapter = config.searchEngine
                const importAdapter = await require(
                    `./tools/${targetAdapter}.js`
                )

                // eslint-disable-next-line new-cap
                return new importAdapter.default(
                    config,
                    new WebBrowser({
                        model: params.model,
                        embeddings: params.embeddings,
                        headers: {
                            'User-Agent': randomUA()
                        }
                    })
                )
            },
            selector(history) {
                const last = history[history.length - 1]

                return fuzzyQuery(last.content as string, [
                    '打开',
                    '浏览',
                    '搜',
                    '关于',
                    '?',
                    '？',
                    'http',
                    'www',
                    'web',
                    '搜索',
                    '什么',
                    'search',
                    'about'
                ])
            }
        })

        await plugin.registerTool('web-browser', {
            async createTool(params, session) {
                return new WebBrowser({
                    model: params.model,
                    embeddings: params.embeddings,
                    headers: {
                        'User-Agent': randomUA()
                    }
                })
            },

            selector(history) {
                const last = history[history.length - 1]

                return fuzzyQuery(last.content as string, [
                    '打开',
                    '浏览',
                    '搜',
                    '关于',
                    '?',
                    '？',
                    'http',
                    'www',
                    'web',
                    '搜',
                    '什么',
                    'search',
                    'about',
                    '?',
                    '？'
                ])
            }
        })

        await plugin.registerToService()
    })
}

export abstract class SearchTool extends Tool {
    name = 'web-search'

    // eslint-disable-next-line max-len
    description = `a search engine. useful for when you need to answer questions about current events. input should be a raw string of keyword. About Search Keywords, you should cut what you are searching for into several keywords and separate them with spaces. For example, "What is the weather in Beijing today?" would be "Beijing weather today"`

    constructor(
        protected config: Config,
        protected _webBrowser: WebBrowser
    ) {
        super({})
    }

    extractUrlSummary(url: string) {
        return this._webBrowser.call(url)
    }
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
}

export const Config: Schema<Config> = Schema.intersect([
    Schema.object({
        searchEngine: Schema.union([
            Schema.const('duckduckgo-lite').description('DuckDuckGo (Lite)'),
            Schema.const('serper').description('Serper (Google)'),
            Schema.const('bing-api').description('必应 (Azure API)')
        ])
            .default('duckduckgo-lite')
            .description('搜索引擎'),
        topK: Schema.number()
            .description('参考结果数量（2~15）')
            .min(2)
            .max(15)
            .step(1)
            .default(5),

        enhancedSummary: Schema.boolean()
            .description('是否使用增强摘要')
            .default(false)
    }).description('搜索设置'),

    Schema.union([
        Schema.object({
            searchEngine: Schema.const('serper').required(),
            serperApiKey: Schema.string()
                .role('secret')
                .description('serper 的 api key')
                .required(),
            serperCountry: Schema.string()
                .description('serper 搜索的国家')
                .default('cn'),
            serperLocation: Schema.string()
                .description('serper 搜索的地区')
                .default('zh-cn'),
            serperSearchResults: Schema.number()
                .min(2)
                .max(20)
                .description('serper 搜索返回的结果数量')
                .default(10)
        }).description('Serper 设置'),
        Schema.object({
            searchEngine: Schema.const('bing-api').required(),
            bingSearchApiKey: Schema.string()
                .role('secret')
                .description('bing api 的 api key')
                .required(),
            bingSearchLocation: Schema.string()
                .description('bing api 搜索的地区')
                .default('zh-CN'),
            azureLocation: Schema.string()
                .description('azure api 搜索的地区')
                .default('global')
        }).description('Bing API 设置'),
        Schema.object({})
    ])
]) as Schema<Config>

export const inject = ['chatluna']

export const name = 'chatluna-search-service'
