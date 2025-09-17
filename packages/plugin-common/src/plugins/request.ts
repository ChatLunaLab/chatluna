import { StructuredTool, ToolParams } from '@langchain/core/tools'
import { Context } from 'koishi'
import { ChatLunaPlugin } from 'koishi-plugin-chatluna/services/chat'
import { randomUA } from 'koishi-plugin-chatluna/utils/request'
import {
    fuzzyQuery,
    getMessageContent
} from 'koishi-plugin-chatluna/utils/string'
import { Config } from '..'
import z from 'zod'
import { BaseMessage } from '@langchain/core/messages'

export async function apply(
    ctx: Context,
    config: Config,
    plugin: ChatLunaPlugin
) {
    if (config.request !== true) {
        return
    }

    const requestGetTool = new RequestsGetTool(
        plugin,
        {
            'User-Agent': randomUA()
        },
        {
            maxOutputLength: config.requestMaxOutputLength
        }
    )

    const requestPostTool = new RequestsPostTool(
        plugin,
        {
            'User-Agent': randomUA()
        },
        {
            maxOutputLength: config.requestMaxOutputLength
        }
    )

    const requestSelector = (history: BaseMessage[]) => {
        if (config.requestSelector.length === 0) {
            return true
        }
        return history.some(
            (message) =>
                message.content != null &&
                fuzzyQuery(
                    getMessageContent(message.content),
                    config.requestSelector
                )
        )
    }

    plugin.registerTool(requestGetTool.name, {
        selector: requestSelector,
        createTool: () => requestGetTool
    })

    plugin.registerTool(requestPostTool.name, {
        selector: requestSelector,
        createTool: () => requestPostTool
    })
}

export interface Headers {
    [key: string]: string
}

export interface RequestTool extends ToolParams {
    headers: Headers
    maxOutputLength: number
}

export class RequestsGetTool extends StructuredTool implements RequestTool {
    name = 'web_fetcher'

    description = `Web content fetcher. Use this to retrieve specific content from websites.
  Fetches content from the specified URL and returns the response text.`

    schema = z.object({
        url: z
            .string()
            .describe(
                'The URL to fetch content from. Must be a valid HTTP/HTTPS URL.'
            )
    })

    maxOutputLength = 30000

    constructor(
        private _plugin: ChatLunaPlugin,
        public headers: Headers = {},
        {
            maxOutputLength,
            ...rest
        }: { maxOutputLength?: number } & ToolParams = {}
    ) {
        super(rest)
        this.maxOutputLength = maxOutputLength ?? this.maxOutputLength
    }

    async _call(input: z.infer<typeof this.schema>) {
        const { url } = input
        try {
            const res = await this._plugin.fetch(url, {
                headers: this.headers
            })
            const text = await res.text()
            return text.slice(0, this.maxOutputLength)
        } catch (error) {
            return `Web fetch failed: ${error.message}`
        }
    }
}

export class RequestsPostTool extends StructuredTool implements RequestTool {
    name = 'web_post'

    description = `Web POST request tool. Use this to send data to websites.
  Sends a POST request with JSON data to the specified URL and returns the response text.`

    schema = z.object({
        url: z
            .string()
            .describe(
                'The URL to send the POST request to. Must be a valid HTTP/HTTPS URL.'
            ),
        data: z
            .record(z.any())
            .describe(
                'The data to send in the POST request body as JSON. Should be a key-value object.'
            )
    })

    maxOutputLength = Infinity

    constructor(
        private _plugin: ChatLunaPlugin,
        public headers: Headers = {},
        {
            maxOutputLength,
            ...rest
        }: { maxOutputLength?: number } & ToolParams = {}
    ) {
        super(rest)
        this.maxOutputLength = maxOutputLength ?? this.maxOutputLength
    }

    async _call(input: z.infer<typeof this.schema>) {
        const { url, data } = input
        try {
            const res = await this._plugin.fetch(url, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    ...this.headers
                },
                body: JSON.stringify(data)
            })
            const text = await res.text()
            return text.slice(0, this.maxOutputLength)
        } catch (error) {
            return `Web POST failed: ${error.message}`
        }
    }
}
