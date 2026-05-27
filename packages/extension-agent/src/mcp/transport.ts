/** @module mcp/transport */

import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import {
    StreamableHTTPClientTransport,
    StreamableHTTPClientTransportOptions
} from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import {
    SSEClientTransport,
    SSEClientTransportOptions
} from '@modelcontextprotocol/sdk/client/sse.js'
import type {
    FetchLike,
    Transport
} from '@modelcontextprotocol/sdk/shared/transport.js'
import { ChatLunaPlugin } from 'koishi-plugin-chatluna/services/chat'
import { McpServerConfig } from '../types'

export function createTransport(
    name: string,
    config: McpServerConfig,
    plugin: ChatLunaPlugin
): Transport {
    const type = config.type ?? 'stdio'

    if (type === 'stdio') {
        return new StdioClientTransport({
            command: config.command,
            args: config.args,
            env: config.env,
            cwd: config.cwd,
            stderr: 'pipe'
        })
    }

    const requestInit =
        (config as StreamableHTTPClientTransportOptions).requestInit ?? {}
    const headers = new Headers(requestInit.headers)
    for (const [k, v] of Object.entries(config.headers ?? {})) {
        headers.set(k, v)
    }

    const transportConfig = {
        ...config,
        requestInit: {
            ...requestInit,
            headers
        },
        fetch: ((url, init) => {
            return plugin.fetch(
                url as Parameters<typeof plugin.fetch>[0],
                init as Parameters<typeof plugin.fetch>[1],
                config.proxy
            ) as unknown as ReturnType<FetchLike>
        }) as FetchLike
    }

    if (type === 'sse') {
        return new SSEClientTransport(
            new URL(config.url),
            transportConfig as SSEClientTransportOptions
        )
    }

    if (type === 'http' || type === 'streamable_http') {
        return new StreamableHTTPClientTransport(
            new URL(config.url),
            transportConfig as StreamableHTTPClientTransportOptions
        )
    }

    throw new Error(`Unsupported transport type: ${type}`)
}
