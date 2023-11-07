import { SearchTool } from '..'
import { JSDOM } from 'jsdom'
import { writeFileSync } from 'fs'
import { SearchResult } from '../types'
import {
    chatLunaFetch,
    randomUA
} from 'koishi-plugin-chatluna/lib/utils/request'

export default class DuckDuckGoSearchTool extends SearchTool {
    async _call(arg: string): Promise<string> {
        let query: string

        try {
            query = JSON.parse(arg).keyword as string
        } catch (e) {
            query = arg
        }

        const res = await chatLunaFetch(
            `https://lite.duckduckgo.com/lite?q=${query}`,
            {
                headers: {
                    'User-Agent': randomUA()
                }
            }
        )

        const html = await res.text()

        const doc = new JSDOM(html, {
            url: res.url
        })

        const result: SearchResult[] = []

        writeFileSync('data/chathub/temp/duckduckgo.html', html)
        const main = doc.window.document.querySelector('div.filters')

        let current = {
            title: '',
            url: '',
            description: ''
        }

        for (const tr of main.querySelectorAll('tbody tr')) {
            const link = tr.querySelector('.result-link')
            const description = tr.querySelector('.result-snippet')

            if (link) {
                current = {
                    title: link.textContent.trim(),
                    url: link.getAttribute('href'),
                    description: ''
                }
            } else if (description) {
                current.description = description.textContent.trim()
            }

            // if all data is ready(not empty), push to result

            if (current.title && current.url && current.description) {
                current.url = matchUrl(current.url)

                if (
                    current.url != null &&
                    current.url.match(
                        // match http/https url
                        /https?:\/\/.+/
                    ) &&
                    this.config.enhancedSummary
                ) {
                    current.description = await this.extractUrlSummary(
                        current.url
                    )
                }

                result.push(current)

                current = {
                    title: '',
                    url: '',
                    description: ''
                }
            }
        }

        return JSON.stringify(result.slice(0, this.config.topK))
    }
}

const matchUrl = (url: string) => {
    let result = url
    const match = url.match(/uddg=(.+?)&/)
    if (match) {
        result = decodeURIComponent(match[1])
    }

    if (result.match(/https?:\/\/.+?/)) {
        return result
    } else {
        return 'https:' + result
    }
}
