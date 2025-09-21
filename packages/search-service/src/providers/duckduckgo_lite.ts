import { Context, Schema, sleep } from 'koishi'
import { Config, logger } from '..'
import { SearchResult } from '../types'
import { SearchManager, SearchProvider } from '../provide'
import { ChatLunaPlugin } from 'koishi-plugin-chatluna/services/chat'
import { decode } from 'html-entities'

// DuckDuckGo callback interfaces from the reference implementation
interface CallbackSearchResult {
    /** Website description */
    a: string
    /** Unknown */
    ae: null
    /** ddg!bang information (ex. w Wikipedia en.wikipedia.org) */
    b?: string
    /** URL */
    c: string
    /** URL of some sort. */
    d: string
    /** Class name associations. */
    da?: string
    /** Unknown */
    h: number
    /** Website hostname */
    i: string
    /** Unknown */
    k: null
    /** Unknown */
    m: number
    /** Unknown */
    o: number
    /** Unknown */
    p: number
    /** Unknown */
    s: string
    /** Website Title */
    t: string
    /** Website URL */
    u: string
}

interface CallbackNextSearch {
    /** URL to the next page of results */
    n: string
}

// Safe search and time enums
enum SafeSearchType {
    STRICT = 0,
    MODERATE = -1,
    OFF = -2
}

enum SearchTimeType {
    ALL = 'a',
    DAY = 'd',
    WEEK = 'w',
    MONTH = 'm',
    YEAR = 'y'
}

class DuckDuckGoSearchProvider extends SearchProvider {
    private readonly SEARCH_REGEX =
        /DDG\.pageLayout\.load\('d',(\[.+\])\);DDG\.duckbar\.load(?:Module)?\('/

    private readonly COMMON_HEADERS = {
        'sec-ch-ua': '"Not=A?Brand";v="8", "Chromium";v="129"',
        'sec-ch-ua-mobile': '?0',
        'sec-ch-ua-platform': '"Windows"',
        'sec-fetch-dest': 'document',
        'sec-fetch-mode': 'navigate',
        'sec-fetch-site': 'none',
        'sec-fetch-user': '?1',
        'sec-gpc': '1',
        'upgrade-insecure-requests': '1',
        'user-agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36'
    }

    async search(
        query: string,
        limit = this.config.topK
    ): Promise<SearchResult[]> {
        if (!query) throw new Error('Query cannot be empty!')

        try {
            const searchResults = await this.performSearch(query, {
                safeSearch: SafeSearchType.MODERATE,
                time: SearchTimeType.ALL,
                locale: 'en-us',
                region: 'wt-wt',
                offset: 0,
                marketRegion: 'en-US'
            })

            return searchResults.slice(0, limit)
        } catch (error) {
            logger.error(`DuckDuckGo search failed: ${error.message}`)
            throw error
        }
    }

    async performSearch(
        query: string,
        options: {
            safeSearch: SafeSearchType
            time: SearchTimeType
            locale: string
            region: string
            offset: number
            marketRegion: string
            vqd?: string
        }
    ): Promise<SearchResult[]> {
        let vqd = options.vqd
        if (!vqd) {
            vqd = await this._getVQD(query)
        }

        const queryObject: Record<string, string> = {
            q: query,
            ...(options.safeSearch !== SafeSearchType.STRICT ? { t: 'D' } : {}),
            l: options.locale,
            ...(options.safeSearch === SafeSearchType.STRICT ? { p: '1' } : {}),
            kl: options.region,
            s: String(options.offset),
            dl: 'en',
            ct: 'US',
            bing_market: options.marketRegion,
            df: options.time as string,
            vqd,
            ...(options.safeSearch !== SafeSearchType.STRICT
                ? { ex: String(options.safeSearch) }
                : {}),
            sp: '1',
            bpa: '1',
            biaexp: 'b',
            msvrtexp: 'b',
            ...(options.safeSearch === SafeSearchType.STRICT
                ? {
                      videxp: 'a',
                      nadse: 'b',
                      eclsexp: 'a',
                      stiaexp: 'a',
                      tjsexp: 'b',
                      related: 'b',
                      msnexp: 'a'
                  }
                : {
                      nadse: 'b',
                      eclsexp: 'b',
                      tjsexp: 'b'
                  })
        }

        const searchParams = new URLSearchParams(queryObject)
        const response = await this._plugin.fetch(
            `https://links.duckduckgo.com/d.js?${searchParams.toString()}`,
            {
                headers: this.COMMON_HEADERS
            }
        )

        if (!response.ok) {
            throw new Error(
                `Failed to fetch data from DuckDuckGo. Status: ${response.status} - ${response.statusText}`
            )
        }

        const responseText = await response.text()

        if (responseText.includes('DDG.deep.is506')) {
            throw new Error('A server error occurred!')
        }

        if (responseText.includes('DDG.deep.anomalyDetectionBlock')) {
            throw new Error(
                'DDG detected an anomaly in the request, you are likely making requests too quickly.'
            )
        }

        const match = this.SEARCH_REGEX.exec(responseText)
        if (!match) {
            throw new Error(
                'Failed to parse search results from DuckDuckGo response'
            )
        }

        const searchResults = JSON.parse(match[1].replace(/\t/g, '    ')) as (
            | CallbackSearchResult
            | CallbackNextSearch
        )[]

        // Check for no results
        if (searchResults.length === 1 && !('n' in searchResults[0])) {
            const onlyResult = searchResults[0] as CallbackSearchResult
            if (
                (!onlyResult.da && onlyResult.t === 'EOF') ||
                !onlyResult.a ||
                onlyResult.d === 'google.com search'
            ) {
                return []
            }
        }

        const results: SearchResult[] = []

        // Populate search results
        for (const search of searchResults) {
            if ('n' in search) continue

            const result = search as CallbackSearchResult
            if (result.u && result.t && result.a) {
                results.push({
                    title: decode(result.t),
                    url: result.u,
                    description: decode(result.a)
                })
            }
        }

        return results
    }

    /**
     * Get the VQD of a search query.
     * @param query The query to search
     * @param ia The type(?) of search
     * @returns The VQD
     */
    async _getVQD(query: string, ia = 'web'): Promise<string> {
        try {
            const queryParams = new URLSearchParams({ q: query, ia })
            const response = await this._plugin.fetch(
                `https://duckduckgo.com/?${queryParams.toString()}`,
                {
                    headers: this.COMMON_HEADERS
                }
            )

            if (!response.ok) {
                throw new Error(
                    `Failed to get the VQD for query "${query}". Status: ${response.status} - ${response.statusText}`
                )
            }

            const responseText = await response.text()
            const vqd = VQD_REGEX.exec(responseText)?.[1]
            if (!vqd) {
                throw new Error(
                    `Failed to extract the VQD from the response for query "${query}".`
                )
            }

            return vqd
        } catch (e) {
            const err = `Failed to get the VQD for query "${query}". Error: ${e.message}`
            throw new Error(err)
        }
    }

    static schema = Schema.const('duckduckgo-lite').i18n({
        '': 'DuckDuckGo (Lite)'
    })

    name = 'duckduckgo-lite'
}

export const VQD_REGEX = /vqd=['"](\d+-\d+(?:-\d+)?)['"]/

export function apply(
    ctx: Context,
    config: Config,
    plugin: ChatLunaPlugin,
    manager: SearchManager
) {
    if (config.searchEngine.includes('duckduckgo-lite')) {
        manager.addProvider(new DuckDuckGoSearchProvider(ctx, config, plugin))
    }
}
