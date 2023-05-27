import { createLogger } from '@dingyi222666/chathub-llm-core/lib/utils/logger'
import { ChatHubPlugin } from "@dingyi222666/koishi-plugin-chathub/lib/services/chat"
import { ToolProvider } from '@dingyi222666/chathub-llm-core/lib/model/base';
import { z } from "zod";
import { Context, Schema } from 'koishi'
import { StructuredTool, Tool } from 'langchain/tools';
import { WebBrowser } from './webbrowser';

const logger = createLogger('@dingyi222666/chathub-search-service')

class SearchServicePlugin extends ChatHubPlugin<SearchServicePlugin.Config> {

    name = "@dingyi222666/chathub-search-service"

    constructor(protected ctx: Context, public readonly config: SearchServicePlugin.Config) {
        super(ctx, config)

        setTimeout(async () => {

            await ctx.chathub.registerPlugin(this)

            this.registerToolProvider("web-search", new SearchToolProvider(config))

            this.registerToolProvider("web-browser",new WebBrowserToolProvider(config))

        })

    }
}


namespace SearchServicePlugin {

    export interface Config extends ChatHubPlugin.Config {
        searchEngine: string
        topK: number
    }

    export const Config: Schema<Config> = Schema.intersect([
        Schema.object({
            searchEngine: Schema.union([
                Schema.const("baidu").description("百度"),
                Schema.const("bing-web").description("必应（网页版）"),
                Schema.const("duckduckgo-lite").description("DuckDuckGo(Lite)"),
            ]
            ).default("bing-web").description('搜索引擎'),
            topK: Schema.number().description('参考结果数量（2~10）')
                .min(2).max(10).step(1).default(2),

        }).description('搜索设置')
    ]) as Schema<Config>

    export const using = ['chathub']

}

export function randomUA() {
    const first = Math.floor(Math.random() * (76 - 55)) + 55
    const third = Math.floor(Math.random() * 3800)
    const fourth = Math.floor(Math.random() * 140)
    const os_type = ['(Windows NT 6.1; WOW64)', '(Windows NT 10.0; WOW64)', '(X11; Linux x86_64)', '(Macintosh; Intel Mac OS X 10_14_5)']
    const chrome_version = `Chrome/${first}.0.${third}.${fourth}`
    const ua = `Mozilla/5.0 ${os_type[Math.floor(Math.random() * os_type.length)]} AppleWebKit/537.36 (KHTML, like Gecko) ${chrome_version} Safari/537.36`
    return ua
}

class SearchToolProvider implements ToolProvider {
    name = "web search"
    description = "search tool for web"

    constructor(protected config: SearchServicePlugin.Config) {

    }

    async createTool(params: Record<string, any>): Promise<Tool> {
        let targetAdapter = this.config.searchEngine
        const importAdapter = await require(`./tools/${targetAdapter}.js`)

        return new importAdapter.default(this.config)
    }
}

class WebBrowserToolProvider implements ToolProvider {
    name = "web browser"
    description = "open any url"

    constructor(protected config: SearchServicePlugin.Config) {

    }

    async createTool(params: Record<string, any>): Promise<Tool> {
        return new WebBrowser({
            model: params.model,
            embeddings: params.embeddings,
            headers: {
                "User-Agent": randomUA(),
            }
        })
    }
}

export abstract class SearchTool extends Tool {
    name = "web-search"

    description = `a search engine. useful for when you need to answer questions about current events. input should be a raw string of keyword'`


}


export default SearchServicePlugin