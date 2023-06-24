import { createLogger } from '@dingyi222666/koishi-plugin-chathub/lib/llm-core/utils/logger'
import { ChatHubPlugin } from "@dingyi222666/koishi-plugin-chathub/lib/services/chat"
import { ToolProvider } from '@dingyi222666/koishi-plugin-chathub/lib/llm-core/model/base';
import { z } from "zod";
import { Context, Schema } from 'koishi'
import { StructuredTool, Tool } from 'langchain/tools';
import { WebBrowser } from './webbrowser';
import { request } from '@dingyi222666/koishi-plugin-chathub/lib/llm-core/utils/request';

const logger = createLogger('@dingyi222666/chathub-search-service')

class SearchServicePlugin extends ChatHubPlugin<SearchServicePlugin.Config> {

    name = "@dingyi222666/chathub-search-service"

    constructor(protected ctx: Context, public readonly config: SearchServicePlugin.Config) {
        super(ctx, config)

        setTimeout(async () => {

            await ctx.chathub.registerPlugin(this)

            this.registerToolProvider("web-search", new SearchToolProvider(config))

            this.registerToolProvider("web-browser", new WebBrowserToolProvider())

        })

    }
}


namespace SearchServicePlugin {

    export interface Config extends ChatHubPlugin.Config {
        searchEngine: string
        topK: number,
        enhancedSummary: boolean

        serperApiKey: string,
        serperCountry: string,
        serperLocation: string,
        serperSearchResults: number,
    }

    export const Config: Schema<Config> = Schema.intersect([
        Schema.object({
            searchEngine: Schema.union([
                Schema.const("baidu").description("百度"),
                Schema.const("bing-web").description("必应（网页版）"),
                Schema.const("duckduckgo-lite").description("DuckDuckGo (Lite)"),
                Schema.const("serper").description("serper (Google)"),
            ]
            ).default("bing-web").description('搜索引擎'),
            topK: Schema.number().description('参考结果数量（2~15）')
                .min(2).max(15).step(1).default(2),

            enhancedSummary: Schema.boolean().description('是否使用增强摘要').default(false),
        }).description('搜索设置'),

        Schema.union([
            Schema.object({
                searchEngine: Schema.const("serper").required(),
                serperApiKey: Schema.string().description("serper 的 api key"),
                serperCountry: Schema.string().description("serper 搜索的国家").default("cn"),
                serperLocation: Schema.string().description("serper 搜索的地区").default("zh-cn"),
                serperSearchResults: Schema.number().min(2).max(20).description("serper 搜索返回的结果数量").default(10),

            }).description("Serper 设置"),
            Schema.object({}),
        ])
    ]) as Schema<Config>

    export const using = ['chathub']

}


class SearchToolProvider implements ToolProvider {
    name = "web search"
    description = "search tool for web"

    constructor(protected config: SearchServicePlugin.Config) {

    }

    async createTool(params: Record<string, any>): Promise<Tool> {
        let targetAdapter = this.config.searchEngine
        const importAdapter = await require(`./tools/${targetAdapter}.js`)

        return new importAdapter.default(this.config,
            new WebBrowser({
                model: params.model,
                embeddings: params.embeddings,
                headers: {
                    "User-Agent": request.randomUA(),
                }
            })
        )
    }
}

class WebBrowserToolProvider implements ToolProvider {
    name = "web browser"
    description = "open any url"


    async createTool(params: Record<string, any>): Promise<Tool> {
        return new WebBrowser({
            model: params.model,
            embeddings: params.embeddings,
            headers: {
                "User-Agent": request.randomUA(),
            }
        })
    }
}

export abstract class SearchTool extends Tool {
    name = "web-search"

    description = `a search engine. useful for when you need to answer questions about current events. input should be a raw string of keyword. About Search Keywords, you should cut what you are searching for into several keywords and separate them with spaces. For example, "What is the weather in Beijing today?" would be "Beijing weather today"`

    constructor(protected config: SearchServicePlugin.Config, protected _webBorwser: WebBrowser) {
        super({

        })
    }

    extractUrlSummary(url: string) {
        return this._webBorwser.call(url)
    }
}


export default SearchServicePlugin