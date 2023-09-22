import { ChatHubPlugin } from '@dingyi222666/koishi-plugin-chathub/lib/services/chat'
import { Context, Schema } from 'koishi'
import { Tool } from 'langchain/tools'
import { WebBrowser } from './webbrowser'
import { ClientConfig } from '@dingyi222666/koishi-plugin-chathub/lib/llm-core/platform/config'
import { randomUA } from '@dingyi222666/koishi-plugin-chathub/lib/utils/request'

export function apply(ctx: Context, config: Config) {
    const plugin = new ChatHubPlugin<ClientConfig, Config>(
        ctx,
        config,
        'search-service',
        false
    )

    plugin.registerTool('web-search', async (params) => {
        const targetAdapter = config.searchEngine
        const importAdapter = await require(`./tools/${targetAdapter}.js`)

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
    })

    plugin.registerTool('web-browser', async (params) => {
        return new WebBrowser({
            model: params.model,
            embeddings: params.embeddings,
            headers: {
                'User-Agent': randomUA()
            }
        })
    })

    ctx.on('ready', async () => {
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

export interface Config extends ChatHubPlugin.Config {
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
            Schema.const('baidu').description('百度'),
            Schema.const('bing-web').description('必应（网页版）'),
            Schema.const('duckduckgo-lite').description('DuckDuckGo (Lite)'),
            Schema.const('serper').description('Serper (Google)'),
            Schema.const('bing-api').description('必应 (Azure API)')
        ])
            .default('bing-web')
            .description('搜索引擎'),
        topK: Schema.number()
            .description('参考结果数量（2~15）')
            .min(2)
            .max(15)
            .step(1)
            .default(2),

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

export const using = ['chathub']

export const name = 'chathub-search-service'
