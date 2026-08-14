/** @module mcp/tools */

import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { AjvJsonSchemaValidator } from '@modelcontextprotocol/sdk/validation/ajv'
import { JsonSchemaType } from '@modelcontextprotocol/sdk/validation'
import { RunnableConfig } from '@langchain/core/runnables'
import { StructuredTool, tool } from '@langchain/core/tools'
import { z } from 'zod'
import { applyToolMask, ToolMask } from 'koishi-plugin-chatluna/llm-core/agent'
import { getMessageContent } from 'koishi-plugin-chatluna/utils/string'
import { Context } from 'koishi'
import { McpConfig, McpIcon } from '../types'
import { callTool } from './tool_call'
import { ToolException } from './types'
import { logger } from '..'

export type McpCatalogTool = {
    name: string
    summary: string
    parameters: string
    inputSchema: Record<string, unknown>
}

export type ToolInfo = {
    name: string
    enabled: boolean
    description: string
    timeout: number
    selector: string[]
    title?: string
    icon?: McpIcon
    catalog: McpCatalogTool
    dispose?: () => void
}

export function createMcpCatalogTool(tool: {
    name: string
    description?: string
    inputSchema: Record<string, unknown>
}): McpCatalogTool {
    const source = tool.inputSchema as {
        properties?: Record<string, { type?: string; description?: string }>
        required?: string[]
    }
    const required = new Set(source.required ?? [])
    const parameters =
        Object.entries(source.properties ?? {})
            .map(
                ([name, info]) =>
                    `${name}${required.has(name) ? ' (required)' : ''}: ${info.type ?? 'value'}${info.description ? ` - ${info.description}` : ''}`
            )
            .join('; ')
            .slice(0, 200) || 'No parameters'

    return {
        name: tool.name,
        summary: (tool.description?.trim() || `MCP tool ${tool.name}`).slice(
            0,
            200
        ),
        parameters,
        inputSchema: tool.inputSchema
    }
}

export function scoreMcpCatalogTool(
    query: string,
    server: string,
    tool: McpCatalogTool
) {
    const value = query.trim().toLowerCase()
    const text =
        `${server} ${tool.name} ${tool.summary} ${tool.parameters}`.toLowerCase()
    let score = text.includes(value) ? 100 : 0

    for (const word of value
        .split(/[^\p{L}\p{N}_-]+/u)
        .filter((item) => item.length > 1)) {
        if (text.includes(word)) score += 10
    }

    if (`${server}/${tool.name}`.toLowerCase() === value) score += 200
    return score > 1 ? score : 0
}

export function validateMcpArguments(
    validator: AjvJsonSchemaValidator,
    schema: Record<string, unknown>,
    args: Record<string, unknown>
): McpArgumentValidation {
    try {
        const result = validator.getValidator<Record<string, unknown>>(
            schema as JsonSchemaType
        )(args)
        if (!result.valid) {
            return {
                valid: false,
                error: 'validation_error',
                message: result.errorMessage
            }
        }
        return { valid: true, data: result.data }
    } catch (error) {
        return {
            valid: false,
            error: 'schema_error',
            message: error instanceof Error ? error.message : String(error)
        }
    }
}

export type McpArgumentValidation =
    | { valid: true; data: Record<string, unknown> }
    | {
          valid: false
          error: 'validation_error' | 'schema_error'
          message: string
      }

export function createMcpLangChainTool(
    serverName: string,
    mcpTool: {
        name: string
        description?: string
        inputSchema: Record<string, unknown>
    },
    t: ToolInfo,
    client: Client,
    ctx: Context
) {
    const langChainTool = tool(
        async (input: unknown, config?: RunnableConfig) => {
            return await callTool(
                serverName,
                mcpTool.name,
                client,
                input as Record<string, unknown>,
                { ...config, timeout: t.timeout },
                undefined,
                ctx,
                logger
            )
        },
        {
            name: mcpTool.name,
            description: mcpTool.description,
            responseFormat: 'content_and_artifact',
            schema: mcpTool.inputSchema as Parameters<typeof tool>[1]['schema']
        }
    )

    t.dispose = ctx.chatluna.platform.registerTool(langChainTool.name, {
        description: mcpTool.description,
        createTool: () => langChainTool,
        selector: (history) =>
            t.selector.length === 0 ||
            history.some((message) =>
                t.selector.some((selector) =>
                    getMessageContent(message.content).includes(selector)
                )
            ),
        meta: {
            source: 'mcp',
            group: 'mcp',
            tags: ['mcp', serverName],
            isMcp: true,
            serverName,
            defaultAvailability: {
                enabled: true,
                main: true,
                chatluna: true,
                characterScope: 'all'
            }
        }
    })
}

export interface McpGatewayHost {
    ctx: Context
    getConfig(): McpConfig
    ensureIndexing(): Promise<void>
    getTool(server: string, name: string): ToolInfo | undefined
    allTools(): { server: string; tool: ToolInfo }[]
    connectForCall(server: string): Promise<Client | undefined>
    validator: AjvJsonSchemaValidator
    registerTool(
        name: string,
        description: string,
        createTool: () => StructuredTool
    ): () => void
}

export class McpGateway {
    private _disposers: (() => void)[] = []

    constructor(private host: McpGatewayHost) {}

    register() {
        if (this._disposers.length > 0) return
        if (Object.keys(this.host.getConfig().mcpServers).length === 0) return

        const search = tool(
            async (input: McpSearchInput, config?: RunnableConfig) => {
                const mask = getRequiredToolCallMask(config)
                await this.host.ensureIndexing()

                if (input.action === 'schema') {
                    if (!input.server || !input.tool) {
                        throw new ToolException(
                            'MCP schema lookup requires an exact server and tool'
                        )
                    }
                    const t = this.host.getTool(input.server, input.tool)
                    if (
                        !this.host.getConfig().mcpServers[input.server] ||
                        !t?.enabled ||
                        !applyToolMask(input.tool, mask)
                    ) {
                        throw new ToolException(
                            `MCP tool schema is unavailable: ${input.server}/${input.tool}`
                        )
                    }
                    return structuredGatewayResponse({
                        action: 'schema',
                        result: {
                            server: input.server,
                            name: t.catalog.name,
                            summary: t.catalog.summary,
                            parameters: t.catalog.parameters,
                            inputSchema: t.catalog.inputSchema
                        }
                    })
                }

                const query = input.query.trim()
                if (!query) {
                    throw new ToolException(
                        'MCP catalog search requires a non-empty query'
                    )
                }
                const results = this.host
                    .allTools()
                    .filter(
                        ({ server, tool }) =>
                            tool.enabled &&
                            this.host.getConfig().mcpServers[server] &&
                            applyToolMask(tool.name, mask)
                    )
                    .map(({ server, tool }) => ({
                        server,
                        item: tool.catalog,
                        score: scoreMcpCatalogTool(query, server, tool.catalog)
                    }))
                    .filter((item) => item.score > 0)
                    .sort(
                        (left, right) =>
                            right.score - left.score ||
                            `${left.server}/${left.item.name}`.localeCompare(
                                `${right.server}/${right.item.name}`
                            )
                    )
                    .slice(0, input.limit)
                    .map(({ server, item }) => ({
                        server,
                        name: item.name,
                        summary: item.summary,
                        parameters: item.parameters
                    }))

                return structuredGatewayResponse({
                    action: 'search',
                    query,
                    results
                })
            },
            {
                name: 'search_mcp_tools',
                description:
                    'Discover MCP tools: action="search" returns compact candidates, ' +
                    'action="schema" loads one exact server/tool inputSchema. Load it before invoke_mcp_tool.',
                responseFormat: 'content_and_artifact',
                schema: mcpSearchSchema
            }
        )
        const invoke = tool(
            async (input: McpInvokeInput, config?: RunnableConfig) =>
                await this._callMcpTool(
                    input.server,
                    input.tool,
                    input.arguments,
                    config
                ),
            {
                name: 'invoke_mcp_tool',
                description:
                    'Invoke one MCP tool after loading its inputSchema with ' +
                    'search_mcp_tools action="schema".',
                responseFormat: 'content_and_artifact',
                schema: mcpInvokeSchema
            }
        )

        for (const gateway of [search, invoke]) {
            this._disposers.push(
                this.host.registerTool(
                    gateway.name,
                    gateway.description,
                    () => gateway
                )
            )
        }
    }

    dispose() {
        for (const dispose of this._disposers) dispose()
        this._disposers = []
    }

    private async _callMcpTool(
        serverName: string,
        toolName: string,
        args: Record<string, unknown>,
        config?: RunnableConfig
    ) {
        const mask = getRequiredToolCallMask(config)
        if (!applyToolMask(toolName, mask)) {
            throw new ToolException(
                `MCP tool is not allowed: ${serverName}/${toolName}`
            )
        }
        if (!this.host.getConfig().mcpServers[serverName]) {
            throw new ToolException(`MCP server not found: ${serverName}`)
        }

        let t = this.host.getTool(serverName, toolName)
        if (!t?.enabled) {
            throw new ToolException(
                `MCP tool is unavailable: ${serverName}/${toolName}`
            )
        }
        const client = await this.host.connectForCall(serverName)
        if (!client) {
            throw new ToolException(`MCP server is unavailable: ${serverName}`)
        }
        t = this.host.getTool(serverName, toolName)
        if (!t?.enabled) {
            throw new ToolException(
                `MCP tool is unavailable: ${serverName}/${toolName}`
            )
        }

        const validation = validateMcpArguments(
            this.host.validator,
            t.catalog.inputSchema,
            args
        )
        if (validation.valid === false) {
            return structuredGatewayResponse({
                ok: false,
                error: validation.error,
                server: serverName,
                tool: toolName,
                message: validation.message,
                inputSchema: t.catalog.inputSchema
            })
        }

        return await callTool(
            serverName,
            toolName,
            client,
            validation.data,
            { ...config, timeout: t.timeout },
            undefined,
            this.host.ctx,
            logger
        )
    }
}

const mcpSearchSchema = z.object({
    action: z
        .enum(['search', 'schema'])
        .describe('search for discovery, schema for one exact tool'),
    query: z
        .string()
        .default('')
        .describe('Capability query. Required when action is search.'),
    limit: z.number().int().min(1).max(20).default(8),
    server: z
        .string()
        .default('')
        .describe('Exact server. Required when action is schema.'),
    tool: z
        .string()
        .default('')
        .describe('Exact tool name. Required when action is schema.')
})

const mcpInvokeSchema = z.object({
    server: z.string().describe('Exact server name returned by search.'),
    tool: z.string().describe('Exact tool name returned by search.'),
    arguments: z
        .record(z.unknown())
        .describe('Arguments matching the separately loaded inputSchema.')
})

type McpSearchInput = z.infer<typeof mcpSearchSchema>
type McpInvokeInput = z.infer<typeof mcpInvokeSchema>

function getRequiredToolCallMask(config?: RunnableConfig) {
    const mask: ToolMask | undefined =
        config?.configurable?.['toolMask'] ??
        config?.configurable?.['agentContext']?.['toolMask']
    const callMask = mask?.toolCallMask ?? mask
    if (!callMask) {
        throw new ToolException('MCP tool permission context is unavailable')
    }
    return callMask
}

function structuredGatewayResponse(payload: Record<string, unknown>) {
    return [JSON.stringify(payload, null, 2), []] as [string, []]
}
