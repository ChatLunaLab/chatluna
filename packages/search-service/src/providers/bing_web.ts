/* eslint-disable no-proto */
import { Context, Schema } from 'koishi'
import { SearchManager, SearchProvider } from '../provide'
import { SearchResult } from '../types'
import { ChatLunaPlugin } from 'koishi-plugin-chatluna/services/chat'
import { Config } from '..'

class BingWebSearchProvider extends SearchProvider {
    async search(
        query: string,
        limit = this.config.topK
    ): Promise<SearchResult[]> {
        const page = await this.ctx.puppeteer.page()

        try {
            // webdriver
            await page.evaluateOnNewDocument(() => {
                const newProto = navigator['__proto__']
                delete newProto.webdriver
                navigator['__proto__'] = newProto

                window['chrome'] = {}
                window['chrome'].app = {
                    InstallState: 'hehe',
                    RunningState: 'haha',
                    getDetails: 'xixi',
                    getIsInstalled: 'ohno'
                }
                window['chrome'].csi = function () {}
                window['chrome'].loadTimes = function () {}
                window['chrome'].runtime = function () {}

                Object.defineProperty(navigator, 'userAgent', {
                    get: () =>
                        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_3) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.4044.113 Safari/537.36'
                })
            })

            await page.goto(
                `https://cn.bing.com/search?form=QBRE&q=${encodeURIComponent(
                    query
                )}`,
                {
                    waitUntil: 'networkidle0'
                }
            )

            const summaries = await page.evaluate(() => {
                const liElements = Array.from(
                    document.querySelectorAll('#b_results > .b_algo')
                )

                return liElements
                    .map((li) => {
                        const abstractElement =
                            li.querySelector('.b_caption > p')
                        const linkElement = li.querySelector('a')
                        const imageElement = li.querySelector('img')

                        const href = linkElement?.getAttribute('href') ?? ''
                        const title = linkElement?.textContent ?? ''
                        const description = abstractElement?.textContent ?? ''
                        const image = imageElement?.getAttribute('src') ?? ''

                        return { url: href, title, description, image }
                    })
                    .filter((summary) => summary.url && summary.title)
            })

            return summaries.slice(0, limit)
        } finally {
            await page.close()
        }
    }

    static schema = Schema.const('bing-web').i18n({
        '': 'Bing (Web)'
    })

    name = 'bing-web'
}

export function apply(
    ctx: Context,
    config: Config,
    plugin: ChatLunaPlugin,
    manager: SearchManager
) {
    if (config.searchEngine.includes('bing-web')) {
        manager.addProvider(new BingWebSearchProvider(ctx, config, plugin))
    }
}
