import type {} from 'koishi-plugin-chatluna-agent'
import { randomUUID } from 'node:crypto'
import { mkdir, writeFile } from 'fs/promises'
import { join } from 'path'
import { BaseMessage } from '@langchain/core/messages'
import { tool } from '@langchain/core/tools'
import type { ChatLunaToolRunnable } from 'koishi-plugin-chatluna/llm-core/platform/types'
import TurndownService from 'turndown'
import { Context } from 'koishi'
import { ChatLunaPlugin } from 'koishi-plugin-chatluna/services/chat'
import { randomUA } from 'koishi-plugin-chatluna/utils/request'
import {
    fuzzyQuery,
    getMessageContent
} from 'koishi-plugin-chatluna/utils/string'
import micromatch from 'micromatch'
import z from 'zod'
import { Config } from '..'

const WEBFETCH_DESCRIPTION = `- Fetches content from a specified URL
- Takes a URL and optional format as input
- Fetches the URL content, converts to requested format (markdown by default)
- Returns the content in the specified format
- Use this tool when you need to retrieve and analyze web content

Usage notes:
  - IMPORTANT: if another tool is present that offers better web fetching capabilities, is more targeted to the task, or has fewer restrictions, prefer using that tool instead of this one.
  - The URL must be a fully-formed valid URL
  - HTTP URLs will be automatically upgraded to HTTPS
  - Format options: "markdown" (default), "text", or "html"
  - This tool is read-only and does not modify any files
  - Results may be summarized if the content is very large`

const webFetchSchema = z.object({
    url: z.string().describe('The URL to fetch content from'),
    format: z
        .enum(['text', 'markdown', 'html'])
        .default('markdown')
        .describe('The format to return the content in'),
    timeout: z
        .number()
        .min(1)
        .max(120)
        .optional()
        .describe('Optional timeout in seconds (max 120)')
})

const webPostSchema = z.object({
    url: z.string().describe('The URL to fetch content from'),
    data: z.record(z.any()).describe('The JSON payload to send'),
    format: z
        .enum(['text', 'markdown', 'html'])
        .default('markdown')
        .describe('The format to return the content in'),
    timeout: z
        .number()
        .min(1)
        .max(120)
        .optional()
        .describe('Optional timeout in seconds (max 120)')
})

const markdown = new TurndownService({
    headingStyle: 'atx',
    hr: '---',
    bulletListMarker: '-',
    codeBlockStyle: 'fenced',
    emDelimiter: '*'
})

markdown.remove(['script', 'style', 'meta', 'link'])

export async function apply(
    ctx: Context,
    config: Config,
    plugin: ChatLunaPlugin
) {
    if (config.request !== true) {
        return
    }

    const headers = {
        'User-Agent': randomUA()
    }
    const outputDir = join(ctx.baseDir, 'data/chatluna/request-output')
    const maxOutputLength = config.requestMaxOutputLength
    const headerConfigs = config.requestHeaders ?? []

    const selector = (history: BaseMessage[]) => {
        if ((config.requestSelector?.length ?? 0) === 0) {
            return true
        }

        return history.some(
            (msg) =>
                msg.content != null &&
                fuzzyQuery(
                    getMessageContent(msg.content),
                    config.requestSelector || []
                )
        )
    }

    const webFetchTool = tool(
        async (
            input: z.infer<typeof webFetchSchema>,
            runConfig?: ChatLunaToolRunnable
        ) => {
            return await requestUrl(
                ctx,
                plugin,
                {
                    method: 'GET',
                    url: input.url,
                    format: input.format,
                    timeout: input.timeout,
                    name: 'web-fetch'
                },
                headers,
                outputDir,
                maxOutputLength,
                headerConfigs,
                runConfig
            )
        },
        {
            name: 'web_fetch',
            description: WEBFETCH_DESCRIPTION,
            schema: webFetchSchema
        }
    )

    const webPostTool = tool(
        async (
            input: z.infer<typeof webPostSchema>,
            runConfig?: ChatLunaToolRunnable
        ) => {
            return await requestUrl(
                ctx,
                plugin,
                {
                    method: 'POST',
                    url: input.url,
                    format: input.format,
                    timeout: input.timeout,
                    body: JSON.stringify(input.data),
                    name: 'web-post'
                },
                headers,
                outputDir,
                maxOutputLength,
                headerConfigs,
                runConfig
            )
        },
        {
            name: 'web_post',
            description: WEBFETCH_DESCRIPTION,
            schema: webPostSchema
        }
    )

    for (const item of [webFetchTool, webPostTool]) {
        plugin.registerTool(item.name, {
            description: item.description,
            selector,
            meta: {
                source: 'extension',
                group: 'plugin-common',
                tags: ['plugin-common', 'request', 'http'],
                defaultAvailability: {
                    enabled: true,
                    main: true,
                    chatluna: true,
                    characterScope: 'none'
                }
            },
            createTool: () => item
        })
    }
}

function getHeadersForUrl(
    url: string,
    headerConfigs: { matcher: string; headers: Record<string, string> }[]
) {
    const hostname = new URL(url).hostname
    for (const item of headerConfigs) {
        if (micromatch.isMatch(hostname, item.matcher, { dot: true })) {
            return item.headers
        }
    }

    return {}
}

async function requestUrl(
    ctx: Context,
    plugin: ChatLunaPlugin,
    input: {
        method: 'GET' | 'POST'
        url: string
        format: 'text' | 'markdown' | 'html'
        timeout?: number
        body?: string
        name: string
    },
    headers: Record<string, string>,
    outputDir: string,
    maxOutputLength: number,
    headerConfigs: { matcher: string; headers: Record<string, string> }[],
    runConfig?: ChatLunaToolRunnable
) {
    const url = normalizeUrl(input.url)
    const timeout = Math.min(Math.max(input.timeout ?? 30, 1), 120) * 1000
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeout)

    try {
        const res = await plugin.fetch(url, {
            method: input.method,
            headers: {
                Accept: getAcceptHeader(input.format),
                ...(input.body ? { 'Content-Type': 'application/json' } : {}),
                ...headers,
                ...getHeadersForUrl(url, headerConfigs)
            },
            body: input.body,
            signal: controller.signal
        })

        if (!res.ok) {
            throw new Error(`Request failed with status code: ${res.status}`)
        }

        return await formatOutput(
            ctx,
            outputDir,
            input.name,
            convertContent(
                await res.text(),
                input.format,
                res.headers.get('content-type') ?? ''
            ),
            maxOutputLength,
            runConfig
        )
    } finally {
        clearTimeout(timer)
    }
}

function normalizeUrl(url: string) {
    const trimmed = url.trim()
    if (trimmed.startsWith('http://')) {
        return `https://${trimmed.slice(7)}`
    }

    if (!trimmed.startsWith('https://')) {
        throw new Error('URL must be a fully-formed HTTP/HTTPS URL')
    }

    return trimmed
}

function getAcceptHeader(format: 'text' | 'markdown' | 'html') {
    if (format === 'markdown') {
        return 'text/markdown;q=1.0, text/x-markdown;q=0.9, text/plain;q=0.8, text/html;q=0.7, */*;q=0.1'
    }

    if (format === 'text') {
        return 'text/plain;q=1.0, text/markdown;q=0.9, text/html;q=0.8, */*;q=0.1'
    }

    return 'text/html;q=1.0, application/xhtml+xml;q=0.9, text/plain;q=0.8, */*;q=0.1'
}

function convertContent(
    content: string,
    format: 'text' | 'markdown' | 'html',
    contentType: string
) {
    if (format === 'html' || !contentType.toLowerCase().includes('html')) {
        return content
    }

    const md = markdown.turndown(content)
    if (format === 'markdown') {
        return md
    }

    return markdownToText(md)
}

function markdownToText(content: string) {
    return content
        .replace(/```([\s\S]*?)```/g, '$1')
        .replace(/`([^`]+)`/g, '$1')
        .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
        .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
        .replace(/^#{1,6}\s+/gm, '')
        .replace(/[>*_~]/g, '')
        .replace(/\r\n/g, '\n')
        .replace(/[ \t]+\n/g, '\n')
        .replace(/\n[ \t]+/g, '\n')
        .replace(/\n{3,}/g, '\n\n')
        .trim()
}

async function formatOutput(
    ctx: Context,
    dir: string,
    name: string,
    text: string,
    limit: number,
    runConfig?: ChatLunaToolRunnable
) {
    const session = await ctx.chatluna_agent?.computer
        .getToolSession(runConfig)
        .catch(() => undefined)

    if (ctx.chatluna_agent) {
        return await ctx.chatluna_agent.truncateTextOutput({
            name,
            text,
            limit,
            session,
            outputDir: dir
        })
    }

    if (text.length <= limit) {
        return text
    }

    const filePath = join(dir, `${name}-${Date.now()}-${randomUUID()}.txt`)
    await mkdir(dir, { recursive: true })
    await writeFile(filePath, text, 'utf-8')
    return `Output too large (${text.length} chars). Truncated preview below.
Full output saved to: ${filePath}

${text.slice(0, limit)}\n...[output truncated]`
}
