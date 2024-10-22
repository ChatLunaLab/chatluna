import { Context, Schema } from 'koishi'
import { ChatLunaPlugin } from 'koishi-plugin-chatluna/services/chat'
import { SearchResult } from './types'
import { Config } from '.'
import { Document } from '@langchain/core/documents'
import { MemoryVectorStore } from 'koishi-plugin-chatluna/llm-core/vectorstores'
import { parseRawModelName } from 'koishi-plugin-chatluna/llm-core/utils/count_tokens'
import { ChatHubBaseEmbeddings } from 'koishi-plugin-chatluna/llm-core/platform/model'

export abstract class SearchProvider {
    constructor(
        protected ctx: Context,
        protected config: Config,
        protected _plugin: ChatLunaPlugin
    ) {}

    abstract search(query: string, limit: number): Promise<SearchResult[]>

    abstract name: string
}

export class SearchManager {
    private providers: Map<string, SearchProvider> = new Map()
    private schemas: Schema[] = []
    private _embeddings: ChatHubBaseEmbeddings | undefined

    constructor(
        private ctx: Context,
        private config: Config,
        private _plugin: ChatLunaPlugin
    ) {}

    addProvider(provider: SearchProvider) {
        this.providers.set(provider.name, provider)

        return () => this._deleteProvider(provider.name)
    }

    getProvider(name: string): SearchProvider | undefined {
        return this.providers.get(name)
    }

    private _deleteProvider(name: string) {
        this.providers.delete(name)
    }

    updateSchema(schema: Schema) {
        this.schemas.push(schema)

        console.log(this.schemas)
        this.ctx.schema.set(
            'search-engine',
            Schema.array(Schema.union(this.schemas))
        )
    }

    async search(
        query: string,
        limit: number = this.config.topK,
        providerNames: string[] = this.config.searchEngine
    ): Promise<SearchResult[]> {
        const providers = providerNames
            ? providerNames
                  .map((name) => this.getProvider(name))
                  .filter(Boolean)
            : Array.from(this.providers.values())

        if (providers.length === 1) {
            // 一个源就不用分了，直接返回
            return providers[0].search(query, limit)
        }

        const searchResults: SearchResult[] = []

        for (const provider of providers) {
            searchResults.push(...(await provider.search(query, limit)))
        }

        return this._reRankResults(query, searchResults, limit)
    }

    private async _getEmbeddings() {
        if (this._embeddings) return this._embeddings

        const [platform, model] = parseRawModelName(
            this.ctx.chatluna.config.defaultEmbeddings
        )
        this._embeddings = (await this.ctx.chatluna.createEmbeddings(
            platform,
            model
        )) as ChatHubBaseEmbeddings

        return this._embeddings
    }

    private async _reRankResults(
        query: string,
        results: SearchResult[],
        limit: number
    ) {
        // 1. 构建临时的向量数据库

        const embeddings = await this._getEmbeddings()

        const vectorStore = new MemoryVectorStore(embeddings)

        // 2. 存储搜索标题进去

        const docs = results.map(
            (r) =>
                ({
                    pageContent: r.title,
                    metadata: r
                }) satisfies Document
        )

        vectorStore.addDocuments(docs)

        // 3. 搜索

        const searchResults = await vectorStore.similaritySearch(query, limit)

        // 4. 重映射

        return searchResults.map((r) => r.metadata) as SearchResult[]
    }
}
