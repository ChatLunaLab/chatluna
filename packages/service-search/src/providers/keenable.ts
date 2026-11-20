import { Context, Schema } from 'koishi'
import { SearchManager, SearchProvider } from '../provide'
import { SearchResult } from '../types'
import { ChatLunaPlugin } from 'koishi-plugin-chatluna/services/chat'
import { Config } from '..'

class KeenableSearchProvider extends SearchProvider {
    async search(
        query: string,
        limit = this.config.topK
    ): Promise<SearchResult[]> {
        // Without an API key, use the keyless public endpoint
        const apiKey = this.config.keenableApiKey
        const headers: Record<string, string> = {
            'Content-Type': 'application/json'
        }
        if (apiKey) {
            headers['X-API-Key'] = apiKey
        } else {
            headers['X-Keenable-Title'] = 'ChatLuna'
        }

        const response = await this._plugin.fetch(
            apiKey
                ? 'https://api.keenable.ai/v1/search'
                : 'https://api.keenable.ai/v1/search/public',
            {
                method: 'POST',
                body: JSON.stringify({ query, max_results: limit }),
                headers
            }
        )

        if (!response.ok) {
            throw new Error(`HTTP error ${response.status}`)
        }

        const res = (await response.json()) as {
            results?: {
                title?: string
                url?: string
                snippet?: string
                description?: string
            }[]
        }

        const results = (res.results ?? []).filter((r) => r.url)

        if (results.length === 0) {
            return [
                {
                    title: 'No results found',
                    description: 'No good search result found',
                    url: ''
                }
            ]
        }

        return results
            .map((r): SearchResult => ({
                title: r.title ?? r.url,
                description: r.snippet || r.description || '',
                url: r.url
            }))
            .slice(0, limit)
    }

    static schema = Schema.const('keenable').i18n({
        '': 'Keenable (API)'
    })

    name = 'keenable'
}

export function apply(
    ctx: Context,
    config: Config,
    plugin: ChatLunaPlugin,
    manager: SearchManager
) {
    if (config.searchEngine.includes('keenable')) {
        manager.addProvider(new KeenableSearchProvider(ctx, config, plugin))
    }
}
