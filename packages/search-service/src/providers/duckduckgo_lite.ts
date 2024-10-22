import { Context, Schema, sleep } from 'koishi'
import { Config, logger } from '..'
import { SearchResult } from '../types'
import { SearchManager, SearchProvider } from '../provide'
import { ChatLunaPlugin } from 'koishi-plugin-chatluna/services/chat'

class DuckDuckGoSearchProvider extends SearchProvider {
    async search(
        query: string,
        limit = this.config.topK
    ): Promise<SearchResult[]> {
        const result: SearchResult[] = []

        for await (const searchResult of this.searchText(query)) {
            result.push({
                title: searchResult.title,
                url: searchResult.href,
                description: searchResult.body
            })
        }

        return result.slice(0, limit)
    }

    async *searchText(
        keywords: string,
        region = 'zh-cn',
        safesearch = 'moderate'
    ) {
        if (!keywords) {
            throw new Error('Keywords are mandatory')
        }

        const vqd = await this._getVQD(keywords)
        if (!vqd) {
            throw new Error('Error in getting vqd')
        }

        const payload: Record<string, string | number> = {
            q: keywords,
            kl: region,
            l: region,
            s: 0,
            vqd,
            o: 'json',
            sp: '0'
        }

        safesearch = safesearch.toLowerCase()
        if (safesearch === 'moderate') {
            payload.ex = '-1'
        } else if (safesearch === 'off') {
            payload.ex = '-2'
        } else if (safesearch === 'on') {
            payload.p = '1'
        }

        const cache = new Set()
        const searchPositions = ['0', '20', '70', '120']

        for (const s of searchPositions) {
            payload.s = s
            const respRaw = (await (
                await this._getUrl(
                    'GET',
                    'https://links.duckduckgo.com/d.js',
                    payload
                )
            )
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                .text()) as any

            if (respRaw.includes('DDG.deep.is506')) {
                throw new Error('A server error occurred!')
            }

            if (respRaw.includes('DDG.deep.anomalyDetectionBlock')) {
                throw new Error(
                    'DDG detected an anomaly in the request, you are likely making requests too quickly.'
                )
            }

            const resp = JSON.parse(respRaw)

            if (!resp) {
                break
            }

            try {
                const pageData = resp.results

                if (!pageData) {
                    break
                }

                let resultExists = false
                for (const row of pageData) {
                    const href = row.u

                    if (
                        href &&
                        !cache.has(href) &&
                        href !== `http://www.google.com/search?q=${keywords}`
                    ) {
                        cache.add(href)
                        const body = _normalize(row.a)
                        if (body) {
                            resultExists = true
                            yield {
                                title: _normalize(row.t),
                                href: _normalizeUrl(href),
                                body
                            }
                        }
                    }
                }

                if (!resultExists) {
                    break
                }
            } catch (error) {
                logger.error(error)
                break
            }
        }
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    async _getUrl(method: string, url: string, params: any) {
        for (let i = 0; i < 3; i++) {
            try {
                const searchParams = new URLSearchParams(params)

                const resp = await this._plugin.fetch(
                    method === 'GET'
                        ? url + '?' + searchParams.toString()
                        : url,
                    {
                        method,
                        body:
                            method !== 'GET'
                                ? searchParams.toString()
                                : undefined
                    }
                )

                if (!resp.ok) {
                    throw new Error(
                        `Failed to fetch data from DuckDuckGo. Status: ${resp.status} - ${resp.statusText}`
                    )
                }

                if (_is500InUrl(resp.url) || resp.status === 202) {
                    throw new Error(
                        `Failed to fetch data from DuckDuckGo. Status: ${resp.status} - ${resp.statusText}`
                    )
                }
                if (resp.status === 200) {
                    return resp
                }
            } catch (ex) {
                logger.warn(`_getUrl() ${url} ${ex.name} ${ex.message}`)
                if (i >= 2 || ex.message.includes('418')) {
                    throw ex
                }
            }
            await sleep(3000)
        }
        return undefined
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
                `https://duckduckgo.com/?${queryParams.toString()}`
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
            // console.log(e)
            // console.log(Object.keys(e))
            // console.log(e.cause)
            // console.log(Object.keys(e.cause))
            // console.log('code', e.cause.code)
            // console.log('message', e.cause.message)
            // console.log('name', e.cause.name)
            const err = `Failed to get the VQD for query "${query}".
      Error: ${e.cause.message}
    `
            throw new Error(err)
        }
    }

    static schema = Schema.const('duckduckgo-lite').i18n({
        '': 'DuckDuckGo (Lite)'
    })

    name = 'duckduckgo-lite'
}

export const VQD_REGEX = /vqd=['"](\d+-\d+(?:-\d+)?)['"]/

// https://github.com/luukschipperheyn/duckduckgo-search

// Simulating the unescape function
function unescape(text: string) {
    // Replace &quot; with "
    return text.replace(/&quot;/g, '"')
}

// Simulating the re.sub function
function sub(pattern: RegExp | string, replacement: string, text: string) {
    return text.replace(pattern, replacement)
}

// Simulating the unquote function
function unquote(url: string) {
    return url // Simulating unquoting
}

const REGEX_STRIP_TAGS = /<[^>]*>/g

// Simulating the main class

// eslint-disable-next-line @typescript-eslint/naming-convention
function _is500InUrl(url) {
    return url.includes('500')
}

// eslint-disable-next-line @typescript-eslint/naming-convention
function _normalize(rawHtml) {
    if (rawHtml) {
        return unescape(sub(REGEX_STRIP_TAGS, '', rawHtml))
    }
    return ''
}

// eslint-disable-next-line @typescript-eslint/naming-convention
function _normalizeUrl(url: string) {
    if (url) {
        return unquote(url).replace(' ', '+')
    }
    return ''
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
