import { InjectData, InjectSource, LLMInjectService } from '@dingyi222666/koishi-plugin-chathub';
import { lookup } from 'dns';
import { Context, Logger, Schema } from 'koishi';



const logger = new Logger('@dingyi222666/llm-search-service')

class SearchSource extends InjectSource<SearchSource.Config> {

    private searchAdapters: Map<string, SearchAdapter> = new Map();

    constructor(ctx: Context, config: SearchSource.Config) {
        super(ctx, config)
        logger.info('llm-search-service started')
    }

    private async getOrLoadAdapter(modelName: string): Promise<SearchAdapter> {
        let targetAdapter = this.searchAdapters.get(modelName)
        if (targetAdapter) return targetAdapter
        const importAdapter = await import(`./adapter/${modelName}`)
        logger.info(`importAdapter: ${JSON.stringify(importAdapter)}`)
        logger.info(`typeof importAdapter: ${typeof importAdapter}`)
        targetAdapter = new importAdapter.default()
        this.searchAdapters.set(modelName, targetAdapter)
        return targetAdapter
    }

    async search(query: string): Promise<InjectData[]> {
        const searchModel = SearchSource.searchAdapterName[this.config.searchAdapter]
        const targetAdapter = await this.getOrLoadAdapter(searchModel)

        const result = await targetAdapter.search(this.ctx, query)

        return result.splice(0, this.config.topK)
    }

}


export interface SearchAdapter {
    search(ctx: Context, query: string): Promise<InjectData[]>
}

namespace SearchSource {


    export const using = ['llminject']

    export interface Config extends LLMInjectService.Config {
        searchAdapter: string
        topK: number
    }


    export const searchAdapterName = {
        "百度": "baidu",
        "必应（网页版）": "bing-web"
    }

    export const Config: Schema<Config> = Schema.intersect([
        LLMInjectService.config,
        Schema.object({
            searchAdapter: Schema.union(
                Object.keys(searchAdapterName)
            ).default("百度").description('搜索引擎'),
            topK: Schema.number().description('参考结果数量（1~10）')
                .min(1).max(10).step(1).default(1),
        }).description('搜索设置')
    ])
}

export const name = '@dingyi222666/llm-search-service'

export default SearchSource

