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
            const response = await page.goto(
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
            const finalUrl = new URL(page.url())
            if (response && response.status() >= 400) {
                throw new Error(
                    `google-web request failed with HTTP ${response.status()}`
                )
            }
            if (
                finalUrl.pathname.includes('/sorry/') ||
                finalUrl.hostname === 'consent.google.com'
            ) {
                throw new Error(
                    'google-web request blocked by captcha or consent page'
                )
            }
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
    const results = Array.from(document.querySelectorAll('#search a > h3'))
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

    if (results.length > 0) return results

    const stats = document.querySelector('#result-stats')?.textContent ?? ''
    if (
        document.querySelector('.obcontainer') ||
        /about 0 results|did not match any/i.test(stats)
    ) {
        return []
    }
    throw new Error('google-web page structure changed or blocked')
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
