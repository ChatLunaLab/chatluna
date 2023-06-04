import SearchServicePlugin, { SearchTool, randomUA } from '..';
import { z } from "zod";
import { request } from "@dingyi222666/koishi-plugin-chathub/lib/llm-core/utils/request"
import { JSDOM } from "jsdom"
import { writeFileSync } from 'fs';

export default class BingSearchTool extends SearchTool {

    constructor(protected config: SearchServicePlugin.Config) {
        super()
    }

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

        const result: ({
            title: string,
            url: string,
            description: string
        })[] = []

        writeFileSync("bing.html", html)
        const main = doc.window.document.querySelector("#b_results")

        for (const li of main.querySelectorAll("li.b_algo")) {
            const title = li.querySelector("h2")?.textContent
            const url = li.querySelector("a")?.href
            const description = li.querySelector("p")


            for (const span of description.querySelectorAll("span")) {
                description.removeChild(span)
            }

            if (title && url && description) {
                result.push({ title, url, description: description.textContent })
            }
        }

        return JSON.stringify(result.slice(0, this.config.topK))
    }

}

const matchUrl = (url: string) => {
    const match = url.match(/uddg=(.+?)&/)
    if (match) {
        return decodeURIComponent(match[1])
    }
    return url
}