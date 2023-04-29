import { InjectData, InjectSource, LLMInjectService, createLogger } from '@dingyi222666/koishi-plugin-chathub';
import { readFileSync } from 'fs';
import { Context, Logger, Schema } from 'koishi';


const logger = createLogger('@dingyi222666/llm-search-service')

class SearchSource extends InjectSource<SearchSource.Config> {

    label = 'llm-search-service'

    private searchAdapters: Map<string, SearchAdapter> = new Map();

    constructor(ctx: Context, config: SearchSource.Config) {
        super(ctx, config)
        logger.debug('llm search service started')
    }

    private async getOrLoadAdapter(modelName: string): Promise<SearchAdapter> {
        let targetAdapter = this.searchAdapters.get(modelName)
        if (targetAdapter) return targetAdapter
        // 只支持编译为javascript后加载
        const importAdapter = await require(`./adapters/${modelName}.js`)
        targetAdapter = new importAdapter.default()
        this.searchAdapters.set(modelName, targetAdapter)
        return targetAdapter
    }

    async search(query: string): Promise<InjectData[]> {
        const searchModel = SearchSource.searchAdapterName[this.config.searchAdapter]
        const targetAdapter = await this.getOrLoadAdapter(searchModel)

        const result = await targetAdapter.search(this.ctx, query)

        logger.debug(`search result: ${JSON.stringify(result)}, query: ${query}, adapter: ${searchModel}`)

        return result.splice(0, this.config.topK).map((item) => {
            if (this.config.lite) {
                return {
                    data: item.data
                }
            }
            return item
        })
    }

}


export interface SearchAdapter {
    search(ctx: Context, query: string): Promise<InjectData[]>
}

namespace SearchSource {

   // export const usage = readFileSync(__dirname + '/../README.md', 'utf8')

    export const using = ['llminject']

    export interface Config extends LLMInjectService.Config {
        searchAdapter: string
        topK: number
        lite: boolean
    }


    export const searchAdapterName = {
        "百度": "baidu",
        "必应（网页版）": "bing-web",
        "DuckDuckGo(Lite)": "duckduckgo-lite",
    }

    export const Config: Schema<Config> = Schema.intersect([
        LLMInjectService.config,
        Schema.object({
            searchAdapter: Schema.union(
                Object.keys(searchAdapterName)
            ).default("百度").description('搜索引擎'),
            topK: Schema.number().description('参考结果数量（1~10）')
                .min(1).max(10).step(1).default(1),
            lite: Schema.boolean().description('是否使用轻量模式（仅返回内容）,节省token占用').default(true)
        }).description('搜索设置')
    ])
}

export const name = '@dingyi222666/llm-search-service'

export default SearchSource

