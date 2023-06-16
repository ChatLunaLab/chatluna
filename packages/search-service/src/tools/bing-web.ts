import { SearchTool } from '..';
import { z } from "zod";
import { request } from "@dingyi222666/koishi-plugin-chathub/lib/llm-core/utils/request"
import { JSDOM } from "jsdom"
import { writeFileSync } from 'fs';
import { SearchResult } from '../types';

export default class BingSearchTool extends SearchTool {

    async _call(arg: z.infer<typeof this.schema>): Promise<string> {

        let query: string

        try {
            query = JSON.parse(arg).keyword as string
        } catch (e) {
            query = arg
        }

        const res = await request.fetch(`https://cn.bing.com/search?q=${query}`)
        const html = await res.text()

        const doc = new JSDOM(html, {
            url: res.url
        })

        const result: SearchResult[] = []

        writeFileSync("bing.html", html)
        const main = doc.window.document.querySelector("#b_results")

        const searchResult = await (Promise.all(Array.from(
            main.querySelectorAll(".c-container"))
            .map(div => this.extract(div))))

        for (const item of searchResult) {
            if (item != null) {
                result.push(item as SearchResult)
            }
        }


        return JSON.stringify(result.slice(0, this.config.topK))
    }

    async extract(li: Element): Promise<SearchResult | void> {
        const title = li.querySelector("h2")?.textContent
        const url = li.querySelector("a")?.href
        const descriptionSpan = li.querySelector("p")


        for (const span of descriptionSpan.querySelectorAll("span")) {
            descriptionSpan.removeChild(span)
        }

        let description = descriptionSpan.textContent

        if (url != null && url.match(
            // match http/https url
            /https?:\/\/.+/) && this.config.enhancedSummary) {
            description = await this.extraUrlSummary(url)
        }

        if (title && url && description) {
            return { title, url, description: description }
        }
    }
}

