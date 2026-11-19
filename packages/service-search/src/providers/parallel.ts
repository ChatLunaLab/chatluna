import { createRequire } from 'node:module'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import type { FetchLike } from '@modelcontextprotocol/sdk/shared/transport.js'
import {
    CallToolResult,
    CallToolResultSchema
} from '@modelcontextprotocol/sdk/types.js'
import { z } from 'zod'
import { Context } from 'koishi'
import { ChatLunaPlugin } from 'koishi-plugin-chatluna/services/chat'
import { Config } from '..'
import { SearchManager, SearchProvider } from '../provide'
import { SearchResult } from '../types'

const { name, version } = createRequire(
    typeof __filename === 'string' ? __filename : import.meta.url
)('koishi-plugin-chatluna-search-service/package.json') as {
    name: string
    version: string
}

const searchResult = z.object({
    results: z.array(
        z.object({
            url: z
                .string()
                .url()
                .regex(/^https?:\/\//i),
            title: z.string().nullish(),
            excerpts: z.array(z.string())
        })
    )
})

class ParallelSearchProvider extends SearchProvider {
    name = 'parallel'

    async search(
        query: string,
        limit = this.config.topK
    ): Promise<SearchResult[]> {
        const client = new Client({ name, version })
        const transport = new StreamableHTTPClientTransport(
            new URL('https://mcp.parallel.ai/mcp'),
            {
                requestInit: {
                    // Identify the plugin so Parallel can measure aggregate free MCP usage.
                    headers: { 'User-Agent': `${name}/${version}` }
                },
                fetch: (url, init) =>
                    this._plugin.fetch(url, {
                        ...(init as Parameters<ChatLunaPlugin['fetch']>[1]),
                        redirect: 'error'
                    }) as unknown as ReturnType<FetchLike>
            }
        )

        try {
            await client.connect(transport)
            const result = (await client.callTool(
                {
                    name: 'web_search',
                    arguments: { objective: query, search_queries: [query] }
                },
                CallToolResultSchema
            )) as CallToolResult

            if (result.isError) {
                throw new Error('Parallel web_search failed')
            }

            const text = result.content.find((block) => block.type === 'text')
            const data = searchResult.parse(
                result.structuredContent ?? JSON.parse(text?.text ?? 'null')
            )

            return data.results.slice(0, limit).map((item) => ({
                url: item.url,
                title: item.title || item.url,
                description: item.excerpts.join('\n\n')
            }))
        } finally {
            await client.close()
        }
    }
}

export function apply(
    ctx: Context,
    config: Config,
    plugin: ChatLunaPlugin,
    manager: SearchManager
) {
    if (config.searchEngine.includes('parallel')) {
        manager.addProvider(new ParallelSearchProvider(ctx, config, plugin))
    }
}
