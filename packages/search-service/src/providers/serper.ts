import { Context, Schema } from 'koishi'
import { SearchManager, SearchProvider } from '../provide'
import { SearchResult } from '../types'
import { ChatLunaPlugin } from 'koishi-plugin-chatluna/services/chat'
import { Config } from '..'

class SerperSearchProvider extends SearchProvider {
    async search(
        query: string,
        limit = this.config.topK
    ): Promise<SearchResult[]> {
        const res = await this.ctx.http.post(
            'https://google.serper.dev/search',
            {
                headers: {
                    'X-API-KEY': this.config.serperApiKey,
                    'Content-Type': 'application/json'
                },
                data: {
                    q: query,
                    gl: this.config.serperCountry ?? 'cn',
                    hl: this.config.serperLocation ?? 'zh-cn'
                }
            }
        )

        if (!res || !res.organic || res.organic.length === 0) {
            return [
                {
                    title: 'No results found',
                    description: 'No good search result found',
                    url: ''
                }
            ]
        }

        return res.organic.slice(0, limit).map(
            (item): SearchResult => ({
                title: item.title,
                description: item.snippet,
                url: item.link
            })
        )
    }

    static schema = Schema.const('serper').i18n({
        '': 'Serper (Google API)'
    })

    name = 'serper'
}

export function apply(
    ctx: Context,
    config: Config,
    plugin: ChatLunaPlugin,
    manager: SearchManager
) {
    if (config.searchEngine.includes('serper')) {
        manager.addProvider(new SerperSearchProvider(ctx, config, plugin))
    }
}
