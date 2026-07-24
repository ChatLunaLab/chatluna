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

        try {
            await page.goto(
                `https://www.google.com.hk/search?q=${encodeURIComponent(
                    query
                )}&oq=${encodeURIComponent(
                    query
                )}&uule=w+CAIQICIaQXVzdGluLFRleGFzLFVuaXRlZCBTdGF0ZXM&hl=en&gl=us&sourceid=chrome&ie=UTF-8#ip=1`,
                {
                    waitUntil: 'domcontentloaded',
                    timeout: this.config.browserTimeout
                }
            )
            return (await page.evaluate(readGoogleResults)).slice(0, limit)
        } finally {
            await page.close()
        }
    }

    static schema = Schema.const('google-web').i18n({
        '': 'Google (Web)'
    })

    name = 'google-web'
}

function readGoogleResults() {
    return Array.from(document.querySelectorAll('#search a > h3'))
        .map((h3) => {
            const a = h3.closest('a')
            return {
                url: a?.getAttribute('href')?.trim() ?? '',
                title: h3.textContent?.trim() ?? '',
                description:
                    h3
                        .closest('.g, .MjjYud')
                        ?.querySelector('.VwiC3b')
                        ?.textContent?.trim() ?? ''
            }
        })
        .filter((r) => r.url && r.title)
}

export function apply(
    ctx: Context,
    config: Config,
    plugin: ChatLunaPlugin,
    manager: SearchManager
) {
    if (config.enableBrowser && config.searchEngine.includes('google-web')) {
        manager.addProvider(new GoogleWebSearchProvider(ctx, config, plugin))
    }
}
