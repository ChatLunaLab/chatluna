import { Context, Schema } from 'koishi'
import { SearchManager, SearchProvider } from '../provide'
import { SearchResult } from '../types'
import { ChatLunaPlugin } from 'koishi-plugin-chatluna/services/chat'
import { Config } from '..'

class TavilySearchProvider extends SearchProvider {
    async search(
        query: string,
        limit = this.config.topK
    ): Promise<SearchResult[]> {
        const body = {
            query,
            api_key: this.config.tavilyApiKey,
            search_depth: 'basic',
            include_images: true,
            include_image_descriptions: true,
            max_results: limit
        }

        const response = await this._plugin.fetch(
            'https://api.tavily.com/search',
            {
                method: 'POST',
                body: JSON.stringify(body),
                headers: {
                    'Content-Type': 'application/json',
                    'User-Agent':
                        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/58.0.3029.110 Safari/537.36'
                }
            }
        )

        if (!response.ok) {
            throw new Error(`HTTP error ${response.status}`)
        }

        const res = (await response.json()) as {
            images?: {
                url: string
                description: string
            }[]
            results: {
                title: string
                content: string
                url: string
            }[]
        }

        if (
            res.results.length === 0 &&
            (!res.images || res.images.length === 0)
        ) {
            return [
                {
                    title: 'No results found',
                    description: 'No good search result found',
                    url: ''
                }
            ]
        }

        const formattedResults = res.results.map(
            (r): SearchResult => ({
                title: r.title,
                description: r.content,
                url: r.url
            })
        )

        const formattedImages = (res.images ?? []).map(
            (img): SearchResult => ({
                title: 'Image',
                description: img.description,
                url: img.url
            })
        )

        return [...formattedResults, ...formattedImages].slice(0, limit)
    }

    static schema = Schema.const('tavily').i18n({
        '': 'Tavily (API)'
    })

    name = 'tavily'
}

export function apply(
    ctx: Context,
    config: Config,
    plugin: ChatLunaPlugin,
    manager: SearchManager
) {
    if (config.searchEngine.includes('tavily')) {
        manager.addProvider(new TavilySearchProvider(ctx, config, plugin))
    }
}
