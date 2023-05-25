import SearchServicePlugin, { SearchTool, randomUA } from '..';
import { z } from "zod";
import { request } from "@dingyi222666/chathub-llm-core/lib/utils/request"
import { JSDOM } from "jsdom"

export default class BingSearchTool extends SearchTool {

    constructor(protected config: SearchServicePlugin.Config) {
        super()
    }

    async _call(arg: z.infer<typeof this.schema>): Promise<string> {

        const query = JSON.parse(arg).keyword as string


        const res = await request.fetch(`https://www.bing.com/search?q=${query}`, {
            headers: {
                // random ua
                "User-Agent": randomUA(),
            }
        })

        const html = await res.text()

        const doc = new JSDOM(html, {
            url: res.url
        })

        const result: ({
            title: string,
            url: string,
            description: string
        })[] = []

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