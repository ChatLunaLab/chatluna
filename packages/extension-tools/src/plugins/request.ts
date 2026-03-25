import { randomUUID } from 'node:crypto'
import { mkdir, writeFile } from 'fs/promises'
import { join } from 'path'
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
import micromatch from 'micromatch'

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
            outputDir: join(ctx.baseDir, 'data/chatluna/request-output'),
            maxOutputLength: config.requestMaxOutputLength,
            headerConfigs: config.requestHeaders ?? []
        }
    )

    const requestPostTool = new RequestsPostTool(
        plugin,
        {
            'User-Agent': randomUA()
        },
        {
            outputDir: join(ctx.baseDir, 'data/chatluna/request-output'),
            maxOutputLength: config.requestMaxOutputLength,
            headerConfigs: config.requestHeaders ?? []
        }
    )

    const requestSelector = (history: BaseMessage[]) => {
        if ((config.requestSelector?.length ?? 0) === 0) {
            return true
        }
        return history.some(
            (message) =>
                message.content != null &&
                fuzzyQuery(
                    getMessageContent(message.content),
                    config?.requestSelector || []
                )
        )
    }

    plugin.registerTool(requestGetTool.name, {
        description: requestGetTool.description,
        selector: requestSelector,
        meta: {
            defaultMain: true,
            defaultChatluna: false,
            defaultCharacter: false,
            defaultCharacterGroup: false,
            defaultCharacterPrivate: false
        },
        createTool: () => requestGetTool
    })

    plugin.registerTool(requestPostTool.name, {
        description: requestPostTool.description,
        selector: requestSelector,
        meta: {
            defaultMain: true,
            defaultChatluna: false,
            defaultCharacter: false,
            defaultCharacterGroup: false,
            defaultCharacterPrivate: false
        },
        createTool: () => requestPostTool
    })
}

export interface Headers {
    [key: string]: string
}

export interface RequestTool extends ToolParams {
    headers: Headers
    maxOutputLength: number
    outputDir: string
    headerConfigs: { matcher: string; headers: Record<string, string> }[]
}

export class RequestsGetTool extends StructuredTool implements RequestTool {
    name = 'web_fetch'

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
    outputDir = ''
    headerConfigs: { matcher: string; headers: Record<string, string> }[] = []

    constructor(
        private _plugin: ChatLunaPlugin,
        public headers: Headers = {},
        {
            maxOutputLength,
            outputDir,
            headerConfigs,
            ...rest
        }: {
            maxOutputLength?: number
            outputDir?: string
            headerConfigs?: {
                matcher: string
                headers: Record<string, string>
            }[]
        } & ToolParams = {}
    ) {
        super(rest)
        this.maxOutputLength = maxOutputLength ?? this.maxOutputLength
        this.outputDir = outputDir ?? this.outputDir
        this.headerConfigs = headerConfigs ?? []
    }

    async _call(input: z.infer<typeof this.schema>) {
        const { url } = input
        try {
            const matchedHeaders = getHeadersForUrl(url, this.headerConfigs)
            const res = await this._plugin.fetch(url, {
                headers: { ...this.headers, ...matchedHeaders }
            })
            const text = await res.text()
            return await formatOutput(
                this.outputDir,
                'web-fetch',
                text,
                this.maxOutputLength
            )
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
    outputDir = ''
    headerConfigs: { matcher: string; headers: Record<string, string> }[] = []

    constructor(
        private _plugin: ChatLunaPlugin,
        public headers: Headers = {},
        {
            maxOutputLength,
            outputDir,
            headerConfigs,
            ...rest
        }: {
            maxOutputLength?: number
            outputDir?: string
            headerConfigs?: {
                matcher: string
                headers: Record<string, string>
            }[]
        } & ToolParams = {}
    ) {
        super(rest)
        this.maxOutputLength = maxOutputLength ?? this.maxOutputLength
        this.outputDir = outputDir ?? this.outputDir
        this.headerConfigs = headerConfigs ?? []
    }

    async _call(input: z.infer<typeof this.schema>) {
        const { url, data } = input
        try {
            const matchedHeaders = getHeadersForUrl(url, this.headerConfigs)
            const res = await this._plugin.fetch(url, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    ...this.headers,
                    ...matchedHeaders
                },
                body: JSON.stringify(data)
            })
            const text = await res.text()
            return await formatOutput(
                this.outputDir,
                'web-post',
                text,
                this.maxOutputLength
            )
        } catch (error) {
            return `Web POST failed: ${error.message}`
        }
    }
}

function getHeadersForUrl(
    url: string,
    headerConfigs: { matcher: string; headers: Record<string, string> }[]
): Record<string, string> {
    try {
        const urlObj = new URL(url)
        const hostname = urlObj.hostname

        for (const config of headerConfigs) {
            if (micromatch.isMatch(hostname, config.matcher, { dot: true })) {
                return config.headers
            }
        }
    } catch (error) {
        // Invalid URL, return empty headers
    }
    return {}
}

function truncateOutput(text: string, limit: number) {
    if (text.length <= limit) {
        return text
    }

    return `${text.slice(0, limit)}\n...[output truncated]`
}

async function formatOutput(
    dir: string,
    name: string,
    text: string,
    limit: number
) {
    if (text.length <= limit) {
        return text
    }

    const filePath = join(dir, `${name}-${Date.now()}-${randomUUID()}.txt`)

    try {
        await mkdir(dir, { recursive: true })
        await writeFile(filePath, text)
        return `Output too large (${text.length} chars). Truncated preview below.
Full output saved to: ${filePath}
Use file_read with this path plus offset/limit to inspect more.

${truncateOutput(text, limit)}`
    } catch (error) {
        return `Output too large (${text.length} chars). Truncated preview below.
Failed to save full output: ${error.message}

${truncateOutput(text, limit)}`
    }
}
