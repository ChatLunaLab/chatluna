import { InjectData, createLogger, request } from '@dingyi222666/koishi-plugin-chathub';
import { SearchAdapter } from '../index';
import { Context } from 'koishi';
import { JSDOM } from 'jsdom';

const logger = createLogger("@dingyi222666/llm-search-service/adapters/duckduckgo-lite")

export default class DuckDuckGoLite implements SearchAdapter {

    async search(ctx: Context, query: string): Promise<InjectData[]> {
        const res = await request.fetch(`https://lite.duckduckgo.com/lite?q=${query}`)


        const html = await res.text()

        const doc = new JSDOM(html, {
            url: res.url
        })


        const result: InjectData[] = []

        const main = doc.window.document.querySelector("div.filters")

        let current: InjectData = {
            title: "",
            source: "",
            data: "",
        }
        for (const tr of main.querySelectorAll("tbody tr")) {

            const link = tr.querySelector(".result-link")
            const description = tr.querySelector(".result-snippet")
           
            if (link) {
                current = {
                    title: link.textContent.trim(),
                    source: link.getAttribute("href"),
                    data: ""
                }
            } else if (description) {
                current.data = description.textContent.trim()
            }

            // if all data is ready(not empty), push to result

            if (current.title && current.source && current.data) {
                result.push(current)
                current = {
                    title: "",
                    source: "",
                    data: "",
                }
            }
        }
        return result
    }

}