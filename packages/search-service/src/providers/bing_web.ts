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
        await page.goto(
            `https://cn.bing.com/search?form=QBRE&q=${encodeURIComponent(
                query
            )}`,
            {
                waitUntil: 'networkidle2'
            }
        )
        const summaries = await page.evaluate(() => {
            const liElements = Array.from(
                document.querySelectorAll('#b_results > .b_algo')
            )

            return liElements.map((li) => {
                const abstractElement = li.querySelector('.b_caption > p')
                const linkElement = li.querySelector('a')
                const href = linkElement.getAttribute('href')
                const title = linkElement.textContent

                const imageElement = li.querySelector('img')
                const image = imageElement
                    ? imageElement.getAttribute('src')
                    : ''

                const description = abstractElement
                    ? abstractElement.textContent
                    : ''
                return { url: href, title, description, image }
            })
        })
        await page.close()

        return summaries.slice(0, limit)
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
