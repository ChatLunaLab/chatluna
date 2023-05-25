import SearchServicePlugin, { SearchTool, randomUA } from '..';
import { z } from "zod";
import { request } from "@dingyi222666/chathub-llm-core/lib/utils/request"
import { JSDOM } from "jsdom"
import { writeFileSync } from 'fs';


async function requestUrl(url: string) {
    // from baidu search result url, the url is a redirect url
    // we need to get the real url (301)

    const res = await request.fetch(url, {
        headers: {
            "User-Agent": randomUA(),
        },
        redirect: "manual",
    })

    const text = await res.text()
    // match window.location.replace args


    if (text.match(/Found/)) {
        return res.headers.get("location")
    }

    return text.match(/window\.location\.replace\("(.+?)"\)/)[1]
}



export default class BaiduSearchTool extends SearchTool {

    constructor(protected config: SearchServicePlugin.Config) {
        super()
    }

    async _call(arg: string): Promise<string> {

        let query: string

        try {
            query = JSON.parse(arg).keyword as string
        } catch (e) {
            query = arg
        }

        const res = await request.fetch(`https://www.baidu.com/s?wd=${query}`)

        const html = await res.text()

        const doc = new JSDOM(html, {
            url: res.url
        })

        const result: ({
            title: string,
            url: string,
            description: string
        })[] = []

        writeFileSync("baidu.html", html)
        const main = doc.window.document.querySelector("#content_left")

        for (const div of main.querySelectorAll(".c-container")) {
            if (div.getAttribute('srcid') == null) {
                continue
            }
            const title = div.querySelector("h3")?.textContent

            if (title == null) {
                continue
            }

            const a = div.querySelector("a")
            const url = await requestUrl(a.href)
            // 正则 选择器匹配类.content-right_[xxxxxx]

            let description: Element | string | null = div.querySelector(".c-span-last")

            if (description != null) {
                const elements = Array.from(description?.querySelectorAll("span").values())
                let find = false
                for (const span of elements) {
                    if (span.className.startsWith("content-right")) {
                        find = true
                        description = span.textContent

                        break
                    }
                }

                if (!find) {
                    const colorText = (<Element>description).querySelector(".c-color-text")

                    if (colorText) {
                        description = colorText.textContent
                    }
                }


            } else {
                description = div.querySelector(".c-gap-top-small")

                const spans = Array.from((description?.querySelectorAll("span") ?? []).values())

                for (const span of spans) {
                    if (span.className.startsWith("content-right")) {
                        description = span.textContent
                        break
                    }
                }


            }

            if (description == null) {
                continue
            }

            if (description instanceof String && description?.length < 1 || !(description instanceof String)) {
                continue
            }

            result.push({ title, url, description: description as string })
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