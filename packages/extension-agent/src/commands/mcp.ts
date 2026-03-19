/** @module commands/mcp */

import { Context, Session, SessionError } from 'koishi'
import {
    ChainMiddlewareContext,
    ChainMiddlewareRunStatus
} from 'koishi-plugin-chatluna/chains'
import { getErrorMessage } from '../utils/shell'

function createMcpCommandMiddleware<T>(options: {
    command: string
    parse: (
        session: Session,
        context: ChainMiddlewareContext
    ) => Promise<T | undefined> | T | undefined
    execute: (input: T) => Promise<string> | string
}) {
    return async (session: Session, context: ChainMiddlewareContext) => {
        if (context.command !== options.command) {
            return ChainMiddlewareRunStatus.SKIPPED
        }

        try {
            const input = await options.parse(session, context)
            if (input !== undefined) {
                context.message = await options.execute(input)
            }
        } catch (error) {
            context.message = `Error: ${getErrorMessage(error)}`
        }

        return ChainMiddlewareRunStatus.STOP
    }
}

function registerMiddleware(
    ctx: Context,
    name:
        | 'list_mcp_tools'
        | 'add_mcp_server'
        | 'remove_mcp_server'
        | 'enable_mcp_tool',
    middleware: ReturnType<typeof createMcpCommandMiddleware>
) {
    ctx.chatluna.chatChain
        .middleware(name, middleware, ctx)
        .after('lifecycle-handle_command')
}

export function apply(ctx: Context) {
    registerMiddleware(
        ctx,
        'list_mcp_tools',
        createMcpCommandMiddleware({
            command: 'list_mcp_tools',
            parse: () => true,
            execute: async () => {
                const service = ctx.chatluna_agent?.mcp
                if (!service) {
                    return 'MCP service not ready'
                }

                const tools = service.listTools()
                if (tools.length === 0) {
                    return 'No tools available'
                }

                const messages = ['MCP Tools:']
                for (const item of tools) {
                    messages.push(
                        `\nName: ${item.name}`,
                        `Enabled: ${item.enabled ? '✅' : '❌'}`,
                        `Description: ${item.description || 'N/A'}`,
                        '---'
                    )
                }

                return messages.join('\n')
            }
        })
    )

    registerMiddleware(
        ctx,
        'add_mcp_server',
        createMcpCommandMiddleware({
            command: 'add_mcp_server',
            parse: async (session, context) => {
                const mcpConfig = context.options?.mcpConfig
                if (!mcpConfig) {
                    context.message = 'Usage: provide MCP server config as JSON'
                    return undefined
                }

                const parsed = JSON.parse(mcpConfig)
                const config = structuredClone(
                    ctx.chatluna_agent.getConsoleData().config
                )
                const servers: Record<string, unknown> = {}

                if (parsed['mcpServers']) {
                    Object.assign(servers, parsed['mcpServers'])
                } else {
                    servers[`server-${Date.now()}`] = parsed
                }

                const conflicts = Object.keys(servers).filter(
                    (name) => config.mcp.mcpServers[name]
                )

                if (conflicts.length > 0) {
                    await session.send(`Conflicts: ${conflicts.join(', ')}`)
                    await session.send('Overwrite? (Y/N)')
                    const response = await session.prompt()
                    if (!response || response.toUpperCase() !== 'Y') {
                        context.message = 'Cancelled'
                        return undefined
                    }
                }

                return servers
            },
            execute: async (servers) => {
                const config = structuredClone(
                    ctx.chatluna_agent.getConsoleData().config
                )
                let count = 0

                for (const [name, server] of Object.entries(servers)) {
                    config.mcp.mcpServers[name] = server as never
                    count += 1
                }

                await ctx.chatluna_agent.saveMcpConfig(config.mcp)
                return `Added ${count} server(s)`
            }
        })
    )

    registerMiddleware(
        ctx,
        'remove_mcp_server',
        createMcpCommandMiddleware({
            command: 'remove_mcp_server',
            parse: (_, context) => {
                const serverName = context.options?.serverName
                if (!serverName) {
                    context.message = 'Usage: provide server name'
                    return undefined
                }

                if (
                    !ctx.chatluna_agent.getConsoleData().config.mcp.mcpServers[
                        serverName
                    ]
                ) {
                    context.message = `Server not found: ${serverName}`
                    return undefined
                }

                return serverName
            },
            execute: async (serverName) => {
                await ctx.chatluna_agent.removeMcpServer(serverName)
                return `Removed server: ${serverName}`
            }
        })
    )

    registerMiddleware(
        ctx,
        'enable_mcp_tool',
        createMcpCommandMiddleware({
            command: 'enable_mcp_tool',
            parse: (_, context) => {
                const toolName = context.options?.toolName
                if (!toolName) {
                    context.message = 'Usage: provide tool name'
                    return undefined
                }

                const item = ctx.chatluna_agent.mcp
                    .listTools()
                    .find((tool) => tool.name === toolName)

                if (!item) {
                    context.message = `Tool not found: ${toolName}`
                    return undefined
                }

                return item
            },
            execute: async (item) => {
                const enabled = !item.enabled
                await ctx.chatluna_agent.saveMcpTool({
                    name: item.name,
                    enabled,
                    timeout: item.timeout,
                    selector: item.selector
                })

                return `Tool ${item.name} ${enabled ? 'enabled' : 'disabled'}`
            }
        })
    )
}

declare module 'koishi-plugin-chatluna/chains' {
    interface ChainMiddlewareName {
        list_mcp_tools: never
        add_mcp_server: never
        remove_mcp_server: never
        enable_mcp_tool: never
    }

    interface ChainMiddlewareContextOptions {
        mcpConfig?: string
        serverName?: string
        toolName?: string
    }
}

export const inject = ['chatluna_agent']
