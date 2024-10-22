import { Context, Schema } from 'koishi'
import { SearchManager, SearchProvider } from '../provide'
import { SearchResult } from '../types'
import { Config } from '..'
import { ChatLunaPlugin } from 'koishi-plugin-chatluna/services/chat'

class BingAPISearchProvider extends SearchProvider {
    async search(query: string, limit = this.config.topK) {
        const searchUrl = new URL('https://api.bing.microsoft.com/v7.0/search')

        const headers = {
            'Ocp-Apim-Subscription-Key': this.config.bingSearchApiKey,
            'Ocp-Apim-Subscription-Region':
                this.config.azureLocation ?? 'global'
        }
        const params = {
            q: query,
            responseFilter: 'Webpages',
            count: limit.toString()
        }

        Object.entries(params).forEach(([key, value]) => {
            searchUrl.searchParams.append(key, value)
        })

        const response = await this._plugin.fetch(searchUrl, { headers })

        if (!response.ok) {
            throw new Error(`HTTP error ${response.status}`)
        }

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const res: any = await response.json()
        const results = res.webPages.value as {
            name: string
            snippet: string
            url: string
        }[]

        if (results.length === 0) {
            return [
                {
                    title: 'No results found',
                    description: 'No results found',
                    url: ''
                }
            ]
        }

        const snippets = results.map(
            (item): SearchResult => ({
                title: item.name,
                description: item.snippet,
                url: item.url
            })
        )

        return snippets
    }

    static schema = Schema.const('bing-api').i18n({
        '': 'Bing (Azure API)'
    })

    name = 'bing-api'
}

export function apply(
    ctx: Context,
    config: Config,
    plugin: ChatLunaPlugin,
    manager: SearchManager
) {
    const searchEngines = config.searchEngine
    if (searchEngines.includes('bing-api')) {
        manager.addProvider(new BingAPISearchProvider(ctx, config, plugin))
    }
}
