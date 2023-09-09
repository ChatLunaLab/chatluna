import { SearchTool } from '..'
import { JSDOM } from 'jsdom'
import { writeFileSync } from 'fs'
import { SearchResult } from '../types'
import { chathubFetch } from '@dingyi222666/koishi-plugin-chathub/lib/utils/request'

export default class BingSearchTool extends SearchTool {
    async _call(arg: string): Promise<string> {
        let query: string

        try {
            query = JSON.parse(arg).keyword as string
        } catch (e) {
            query = arg
        }

        const res = await chathubFetch(`https://cn.bing.com/search?q=${query}`)
        const html = await res.text()

        const doc = new JSDOM(html, {
            url: res.url
        })

        const result: SearchResult[] = []

        writeFileSync('data/chathub/temp/bing.html', html)
        const main = doc.window.document.querySelector('#b_results')

        const searchResult = await Promise.all(Array.from(main.querySelectorAll('.c-container')).map((div) => this.extract(div)))

        for (const item of searchResult) {
            if (item != null) {
                result.push(item as SearchResult)
            }
        }

        return JSON.stringify(result.slice(0, this.config.topK))
    }

    async extract(li: Element): Promise<SearchResult | void> {
        const title = li.querySelector('h2')?.textContent
        const url = li.querySelector('a')?.href
        const descriptionSpan = li.querySelector('p')

        for (const span of descriptionSpan.querySelectorAll('span')) {
            descriptionSpan.removeChild(span)
        }

        let description = descriptionSpan.textContent

        if (
            url != null
            && url.match(
                // match http/https url
                /https?:\/\/.+/,
            ) &&
            this.config.enhancedSummary
        ) {
            description = await this.extractUrlSummary(url)
        }

        if (title && url && description) {
            return { title, url, description }
        }
    }
}
