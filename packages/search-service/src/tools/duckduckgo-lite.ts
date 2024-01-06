import { logger, SearchTool } from '..'
import { SearchResult } from '../types'
import { chatLunaFetch } from 'koishi-plugin-chatluna/lib/utils/request'
import { sleep } from 'koishi'

export default class DuckDuckGoSearchTool extends SearchTool {
    async _call(arg: string): Promise<string> {
        let query: string

        try {
            query = JSON.parse(arg).keyword as string
        } catch (e) {
            query = arg
        }

        const result: SearchResult[] = []

        for await (const searchResult of this.searchText(query)) {
            result.push({
                title: searchResult.title,
                url: searchResult.href,
                description: this.config.enhancedSummary
                    ? await this.extractUrlSummary(searchResult.href)
                    : searchResult.body
            })
        }

        return JSON.stringify(result.slice(0, this.config.topK))
    }

    async *searchText(
        keywords: string,
        region = 'zh-cn',
        safesearch = 'moderate'
    ) {
        if (!keywords) {
            throw new Error('Keywords are mandatory')
        }

        const vqd = await this._getVqd(keywords)
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
            const resp = (await (
                await this._getUrl(
                    'GET',
                    'https://links.duckduckgo.com/d.js',
                    payload
                )
            )
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                .json()) as any

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

                const resp = await chatLunaFetch(
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

                if (_is500InUrl(resp.url) || resp.status === 202) {
                    throw new Error('')
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
        return null
    }

    async _getVqd(keywords: string) {
        try {
            const resp = await (
                await this._getUrl('GET', 'https://duckduckgo.com', {
                    q: keywords
                })
            ).text()
            if (resp) {
                for (const [c1, c2] of [
                    ['vqd="', '"'],
                    ['vqd=', '&'],
                    ["vqd='", "'"]
                ]) {
                    try {
                        const start = resp.indexOf(c1) + c1.length
                        const end = resp.indexOf(c2, start)
                        return resp.substring(start, end)
                    } catch (error) {
                        logger.warn(
                            `_getVqd() keywords=${keywords} vqd not found`
                        )
                    }
                }
            }
        } catch (error) {
            logger.error('eyyy', error)
            // Handle error
        }
        return null
    }
}

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
function _normalizeUrl(url) {
    if (url) {
        return unquote(url).replace(' ', '+')
    }
    return ''
}
