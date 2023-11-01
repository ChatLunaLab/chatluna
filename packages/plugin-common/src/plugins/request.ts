import { Context } from 'koishi'
import { Config } from '..'
import {
    chathubFetch,
    randomUA
} from '@dingyi222666/koishi-plugin-chathub/lib/utils/request'
import { Tool } from 'langchain/tools'
import { ChatHubPlugin } from '@dingyi222666/koishi-plugin-chathub/lib/services/chat'

export async function apply(
    ctx: Context,
    config: Config,
    plugin: ChatHubPlugin
) {
    if (config.request !== true) {
        return
    }

    const requestGetTool = new RequestsGetTool(
        {
            'User-Agent': randomUA()
        },
        {
            maxOutputLength: config.requestMaxOutputLength
        }
    )

    const requestPostTool = new RequestsPostTool(
        {
            'User-Agent': randomUA()
        },
        {
            maxOutputLength: config.requestMaxOutputLength
        }
    )

    plugin.registerTool(requestGetTool.name, async () => {
        return {
            selector(history) {
                return history.some(
                    (item) =>
                        item.content.includes('url') ||
                        item.content.includes('http') ||
                        item.content.includes('request') ||
                        item.content.includes('请求') ||
                        item.content.includes('网页') ||
                        item.content.includes('get')
                )
            },
            tool: requestGetTool
        }
    })
    plugin.registerTool(requestPostTool.name, async () => {
        return {
            selector(history) {
                return history.some(
                    (item) =>
                        item.content.includes('url') ||
                        item.content.includes('http') ||
                        item.content.includes('request') ||
                        item.content.includes('请求') ||
                        item.content.includes('网页') ||
                        item.content.includes('post')
                )
            },
            tool: requestPostTool
        }
    })
}

export interface Headers {
    [key: string]: string
}

export interface RequestTool {
    headers: Headers
    maxOutputLength: number
}

export class RequestsGetTool extends Tool implements RequestTool {
    name = 'requests_get'

    maxOutputLength = 2000

    constructor(
        public headers: Headers = {},
        { maxOutputLength }: { maxOutputLength?: number } = {}
    ) {
        super({
            ...headers
        })

        this.maxOutputLength = maxOutputLength ?? this.maxOutputLength
    }

    /** @ignore */
    async _call(input: string) {
        const res = await chathubFetch(input, {
            headers: this.headers
        })
        const text = await res.text()
        return text.slice(0, this.maxOutputLength)
    }

    description = `A portal to the internet. Use this when you need to get specific content from a website.
  Input should be a url string (i.e. "https://www.google.com"). The output will be the text response of the GET request.`
}

export class RequestsPostTool extends Tool implements RequestTool {
    name = 'requests_post'

    maxOutputLength = Infinity

    constructor(
        public headers: Headers = {},
        { maxOutputLength }: { maxOutputLength?: number } = {}
    ) {
        super({
            ...headers
        })

        this.maxOutputLength = maxOutputLength ?? this.maxOutputLength
    }

    /** @ignore */
    async _call(input: string) {
        try {
            const { url, data } = JSON.parse(input)
            const res = await chathubFetch(url, {
                method: 'POST',
                headers: this.headers,
                body: JSON.stringify(data)
            })
            const text = await res.text()
            return text.slice(0, this.maxOutputLength)
        } catch (error) {
            return `${error}`
        }
    }

    description = `Use this when you want to POST to a website.
  Input should be a json string with two keys: "url" and "data".
  The value of "url" should be a string, and the value of "data" should be a dictionary of
  key-value pairs you want to POST to the url as a JSON body.
  Be careful to always use double quotes for strings in the json string
  The output will be the text response of the POST request.`
}
