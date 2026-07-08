import { Context, Schema } from 'koishi'
import { SearchManager, SearchProvider } from '../provide'
import { SearchResult } from '../types'
import { Config } from '..'
import { ChatLunaPlugin } from 'koishi-plugin-chatluna/services/chat'

class BingAPISearchProvider extends SearchProvider {
    async search(query: string, limit = this.config.topK) {
        const searchUrl = new URL('https://api.bing.microsoft.com/v7.0/search')

        searchUrl.searchParams.set('q', query)
        searchUrl.searchParams.set('responseFilter', 'Webpages')
        searchUrl.searchParams.set('count', limit.toString())
        searchUrl.searchParams.set('mkt', this.config.bingSearchLocation)

        const response = await this._plugin.fetch(searchUrl, {
            headers: {
                'Ocp-Apim-Subscription-Key': this.config.bingSearchApiKey,
                'Ocp-Apim-Subscription-Region': this.config.azureLocation
            }
        })

        if (!response.ok) {
            throw new Error(`HTTP error ${response.status}`)
        }

        const res = (await response.json()) as BingAPIResponse
        const results = res.webPages?.value ?? []

        if (results.length === 0) {
            return [
                {
                    title: 'No results found',
                    description: 'No results found',
                    url: ''
                }
            ]
        }

        return results.map((item): SearchResult => ({
            title: item.name,
            description: item.snippet,
            url: item.url
        }))
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

interface BingAPIResponse {
    webPages?: {
        value: {
            name: string
            snippet: string
            url: string
        }[]
    }
}
