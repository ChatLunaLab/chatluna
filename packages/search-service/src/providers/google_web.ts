import { Context, Schema } from 'koishi'
import { SearchManager, SearchProvider } from '../provide'
import { SearchResult } from '../types'
import { ChatLunaPlugin } from 'koishi-plugin-chatluna/services/chat'
import { Config } from '..'

class GoogleWebSearchProvider extends SearchProvider {
    async search(
        query: string,
        limit = this.config.topK
    ): Promise<SearchResult[]> {
        const page = await this.ctx.puppeteer.page()
        await page.goto(
            `https://www.google.com.hk/search?q=${encodeURIComponent(
                query
            )}&oq=${encodeURIComponent(
                query
            )}&uule=w+CAIQICIaQXVzdGluLFRleGFzLFVuaXRlZCBTdGF0ZXM&hl=en&gl=us&sourceid=chrome&ie=UTF-8%22#ip=1`,
            {
                waitUntil: 'networkidle2'
            }
        )
        const summaries = await page.evaluate(() => {
            const liElements = Array.from(
                document.querySelector('#search > div > div').childNodes
            ) as HTMLElement[]

            return liElements.map((li) => {
                const linkElement = li.querySelector('a')
                const href = linkElement.getAttribute('href')
                const title = linkElement.querySelector('a > h3').textContent
                const abstract = Array.from(
                    li.querySelectorAll(
                        'div > div > div > div > div > div > span'
                    )
                )
                    .map((e) => e.textContent)
                    .join('')
                return { url: href, title, description: abstract }
            })
        })
        await page.close()

        return summaries.slice(0, limit)
    }

    static schema = Schema.const('google-web').i18n({
        '': 'Google (Web)'
    })

    name = 'google-web'
}

export function apply(
    ctx: Context,
    config: Config,
    plugin: ChatLunaPlugin,
    manager: SearchManager
) {
    if (config.searchEngine.includes('google-web')) {
        manager.addProvider(new GoogleWebSearchProvider(ctx, config, plugin))
    }
}
