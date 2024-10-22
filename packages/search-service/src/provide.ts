import { Context, Schema } from 'koishi'
import { ChatLunaPlugin } from 'koishi-plugin-chatluna/services/chat'
import { SearchResult } from './types'
import { Config } from '.'

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
        providerNames?: string[]
    ): Promise<SearchResult[]> {
        // TODO: reranker

        const results: SearchResult[] = []
        const providers = providerNames
            ? providerNames
                  .map((name) => this.getProvider(name))
                  .filter(Boolean)
            : Array.from(this.providers.values())

        for (const provider of providers) {
            const providerResults = await provider.search(query, limit)
            results.push(...providerResults)
        }

        return results.slice(0, limit)
    }
}
