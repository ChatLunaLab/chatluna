import { Context, Schema } from 'koishi'
import { Config, logger } from '..'
import { SearchResult } from '../types'
import { SearchManager, SearchProvider } from '../provide'
import { ChatLunaPlugin } from 'koishi-plugin-chatluna/services/chat'
import { decode } from 'html-entities'

/**
 * Default base URLs for DuckDuckGo search
 */
const DEFAULT_BASE_URLS = {
    text: 'https://html.duckduckgo.com/html',
    lite: 'https://lite.duckduckgo.com/lite/',
    images: 'https://duckduckgo.com/i.js',
    news: 'https://duckduckgo.com/news.js'
}

/**
 * DuckDuckGo VQD extraction regex
 */
const VQD_REGEX = /vqd=['"](\d+-\d+(?:-\d+)?)['"]/

class DuckDuckGoSearchProvider extends SearchProvider {
    private readonly useLite: boolean
    private readonly searchType: string
    private readonly COMMON_HEADERS: Record<string, string>

    constructor(ctx: Context, config: Config, plugin: ChatLunaPlugin) {
        super(ctx, config, plugin)

        // Default to standard (non-lite) mode
        this.useLite = false
        this.searchType = 'text'

        this.COMMON_HEADERS = {
            'User-Agent':
                'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/132.0.4472.124 Safari/537.36',
            'Sec-Fetch-User': '?1'
        }
    }

    async search(
        query: string,
        limit = this.config.topK
    ): Promise<SearchResult[]> {
        if (!query) throw new Error('Query cannot be empty!')

        try {
            // Try standard search first, fallback to lite if it fails
            const searchResults = await this.performLiteSearch(query, limit)
            logger.debug('DuckDuckGo lite search successful')

            return searchResults.slice(0, limit)
        } catch (error) {
            logger.error(`DuckDuckGo search failed: ${error.message}`)
            throw error
        }
    }

    /**
     * Performs a lite DuckDuckGo search (fallback method)
     */
    async performLiteSearch(
        query: string,
        maxResults: number
    ): Promise<SearchResult[]> {
        const searchParams = new URLSearchParams({
            dc: String(maxResults),
            q: query
        })

        const response = await this._plugin.fetch(
            `${DEFAULT_BASE_URLS.lite}?${searchParams.toString()}`,
            {
                headers: {
                    ...this.COMMON_HEADERS,
                    Referer: 'https://lite.duckduckgo.com/',
                    'User-Agent':
                        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_11_6) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/61.0.3163.100 Safari/537.36'
                }
            }
        )

        if (!response.ok) {
            throw new Error(
                `Failed to fetch data from DuckDuckGo Lite. Status: ${response.status} - ${response.statusText}`
            )
        }

        const htmlContent = await response.text()
        return this.parseLiteResults(htmlContent, maxResults)
    }

    /**
     * Parse lite DuckDuckGo HTML results
     */
    private parseLiteResults(html: string, maxResults: number): SearchResult[] {
        const results: SearchResult[] = []
        const cache = new Set<string>()

        // Improved regex patterns based on actual HTML structure
        // Match: <a rel="nofollow" href="URL" class='result-link'>TITLE</a>
        const resultLinkRegex =
            /<a[^>]*?href="([^"]*)"[^>]*?class=['"]result-link['"][^>]*?>([^<]*?)<\/a>/gi

        // Match snippet in the following <tr> with class 'result-snippet'
        // <td class='result-snippet'>SNIPPET_CONTENT</td>
        const snippetRegex =
            /<td[^>]*?class=['"]result-snippet['"][^>]*?>(.*?)<\/td>/gi

        const links: { url: string; title: string }[] = []
        const snippets: string[] = []

        // Extract all result links and titles
        let linkMatch: RegExpMatchArray | null
        while ((linkMatch = resultLinkRegex.exec(html)) !== null) {
            const url = this.cleanUrl(linkMatch[1])
            const title = this.normalizeText(linkMatch[2])

            // Skip sponsored links and internal DuckDuckGo links
            if (
                url &&
                title &&
                !url.includes('duckduckgo.com/y.js') &&
                !url.includes('duckduckgo-help-pages')
            ) {
                links.push({ url, title })
            }
        }

        // Extract all snippets
        let snippetMatch: RegExpMatchArray | null
        while ((snippetMatch = snippetRegex.exec(html)) !== null) {
            const snippet = this.normalizeText(snippetMatch[1])
            snippets.push(snippet)
        }

        // Combine links with their corresponding snippets
        // Note: In the HTML structure, snippets appear after links but may not have 1:1 correspondence
        // due to sponsored results, so we need to handle this carefully
        let snippetIndex = 0
        for (let i = 0; i < links.length && results.length < maxResults; i++) {
            const link = links[i]

            if (link.url && link.title && !cache.has(link.url)) {
                cache.add(link.url)

                // Try to find corresponding snippet
                let snippet = ''
                if (snippetIndex < snippets.length) {
                    snippet = snippets[snippetIndex]
                    snippetIndex++
                }

                results.push({
                    title: link.title,
                    url: link.url,
                    description: snippet || ''
                })
            }
        }

        return results
    }

    /**
     * Clean and decode URL, handling DuckDuckGo redirects
     */
    private cleanUrl(url: string): string {
        if (!url) return ''

        // Handle DuckDuckGo redirect URLs
        if (url.startsWith('/l/?uddg=')) {
            try {
                const decoded = decodeURIComponent(url.replace('/l/?uddg=', ''))
                return this.normalizeUrl(decoded)
            } catch {
                return url
            }
        }

        return this.normalizeUrl(url)
    }

    /**
     * Normalize text by removing excess whitespace and decoding HTML entities
     */
    private normalizeText(text: string): string {
        if (!text) return ''

        // Remove HTML tags first
        const withoutTags = text.replace(/<[^>]*>/g, ' ')
        // Decode HTML entities
        const decoded = decode(withoutTags)
        // Normalize whitespace
        return decoded.replace(/\s+/g, ' ').replace(/\n/g, ' ').trim()
    }

    /**
     * Normalize URLs by ensuring they start with http/https
     */
    private normalizeUrl(url: string): string {
        if (!url) return ''
        if (url.startsWith('//')) {
            return `https:${url}`
        }
        if (!url.startsWith('http://') && !url.startsWith('https://')) {
            return `https://${url}`
        }
        return url
    }

    /**
     * Extract VQD parameter for API calls (future use)
     */
    private extractVqd(html: string): string | null {
        try {
            const match = html.match(VQD_REGEX)
            return match ? match[1] : null
        } catch {
            return null
        }
    }

    static schema = Schema.const('duckduckgo-lite').i18n({
        '': 'DuckDuckGo (Lite)'
    })

    name = 'duckduckgo-lite'
}

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
