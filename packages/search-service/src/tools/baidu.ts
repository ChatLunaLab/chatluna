import SearchServicePlugin, { SearchTool } from '..';
import { z } from "zod";
import { request } from "@dingyi222666/koishi-plugin-chathub/lib/llm-core/utils/request"
import { JSDOM } from "jsdom"
import { writeFileSync } from 'fs';
import { WebBrowser } from '../webbrowser';
import { SearchResult } from '../types';


async function requestUrl(url: string) {
    // from baidu search result url, the url is a redirect url
    // we need to get the real url (301)

    const res = await request.fetch(url, {
        headers: {
            "User-Agent": request.randomUA()
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

    async _call(arg: string): Promise<string> {

        let query: string

        try {
            query = JSON.parse(arg).keyword as string
        } catch (e) {
            query = arg
        }

        const res = await request.fetch(`https://www.baidu.com/s?wd=${query}`, {
            headers: {
                "User-Agent": request.randomUA(),
            }
        })

        const html = await res.text()

        const doc = new JSDOM(html, {
            url: res.url
        })

        const result: SearchResult[] = []

        writeFileSync("data/chathub/temp/baidu.html", html)
        const main = doc.window.document.querySelector("#content_left")

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

    async extract(div: Element): Promise<SearchResult | void> {
        if (div.getAttribute('srcid') == null) {
            return null
        }
        const title = div.querySelector("h3")?.textContent

        if (title == null) {
            return
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

        if (url != null && url.match(
            // match http/https url
            /https?:\/\/.+/) && this.config.enhancedSummary) {
            description = await this.extractUrlSummary(url)

        }

        if (description == null) {
            return
        }

        if (description instanceof String && description?.length < 1 || !(description instanceof String)) {
            return
        }

        return {
            title,
            url,
            description: description as string
        }
    }
}

