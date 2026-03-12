import { Context } from 'koishi'
import { ChainMiddlewareRunStatus } from 'koishi-plugin-chatluna/chains'

export function apply(ctx: Context) {
    const chain = ctx.chatluna.chatChain

    chain
        .middleware(
            'list_mcp_tools',
            async (session, context) => {
                const { command } = context

                if (command !== 'list_mcp_tools')
                    return ChainMiddlewareRunStatus.SKIPPED

                try {
                    const service = ctx.chatluna_agent?.mcp
                    if (!service) {
                        context.message = 'MCP service not ready'
                        return ChainMiddlewareRunStatus.STOP
                    }

                    const tools = service.listTools()

                    if (tools.length === 0) {
                        context.message = 'No tools available'
                        return ChainMiddlewareRunStatus.STOP
                    }

                    const messages = ['MCP Tools:']
                    for (const tool of tools) {
                        messages.push(
                            `\nName: ${tool.name}`,
                            `Enabled: ${tool.enabled ? '✅' : '❌'}`,
                            `Description: ${tool.description || 'N/A'}`,
                            '---'
                        )
                    }

                    context.message = messages.join('\n')
                } catch (error) {
                    context.message = `Error: ${error.message}`
                }

                return ChainMiddlewareRunStatus.STOP
            },
            ctx
        )
        .after('lifecycle-handle_command')

    chain
        .middleware(
            'add_mcp_server',
            async (session, context) => {
                const {
                    command,
                    options: { mcpConfig }
                } = context

                if (command !== 'add_mcp_server')
                    return ChainMiddlewareRunStatus.SKIPPED

                if (!mcpConfig) {
                    context.message = 'Usage: provide MCP server config as JSON'
                    return ChainMiddlewareRunStatus.STOP
                }

                try {
                    const parsedInput = JSON.parse(mcpConfig)
                    const config = structuredClone(
                        ctx.chatluna_agent.getConsoleData().config
                    )

                    const serversToAdd: Record<string, any> = {}

                    if (parsedInput['mcpServers']) {
                        Object.assign(serversToAdd, parsedInput['mcpServers'])
                    } else {
                        const serverName = `server-${Date.now()}`
                        serversToAdd[serverName] = parsedInput
                    }

                    const conflicts: string[] = []
                    for (const name of Object.keys(serversToAdd)) {
                        if (config.mcp.mcpServers[name]) {
                            conflicts.push(name)
                        }
                    }

                    if (conflicts.length > 0) {
                        await session.send(`Conflicts: ${conflicts.join(', ')}`)
                        await session.send('Overwrite? (Y/N)')

                        const response = await session.prompt()

                        if (!response || response.toUpperCase() !== 'Y') {
                            context.message = 'Cancelled'
                            return ChainMiddlewareRunStatus.STOP
                        }
                    }

                    let addedCount = 0
                    for (const [name, serverConfig] of Object.entries(
                        serversToAdd
                    )) {
                        config.mcp.mcpServers[name] = serverConfig
                        addedCount++
                    }

                    await ctx.chatluna_agent.saveMcpConfig(config.mcp)

                    context.message = `Added ${addedCount} server(s)`
                } catch (error) {
                    context.message = `Error: ${error.message}`
                }

                return ChainMiddlewareRunStatus.STOP
            },
            ctx
        )
        .after('lifecycle-handle_command')

    chain
        .middleware(
            'remove_mcp_server',
            async (session, context) => {
                const {
                    command,
                    options: { serverName }
                } = context

                if (command !== 'remove_mcp_server')
                    return ChainMiddlewareRunStatus.SKIPPED

                if (!serverName) {
                    context.message = 'Usage: provide server name'
                    return ChainMiddlewareRunStatus.STOP
                }

                try {
                    const config = structuredClone(
                        ctx.chatluna_agent.getConsoleData().config
                    )

                    if (!config.mcp.mcpServers[serverName]) {
                        context.message = `Server not found: ${serverName}`
                        return ChainMiddlewareRunStatus.STOP
                    }

                    await ctx.chatluna_agent.removeMcpServer(serverName)

                    context.message = `Removed server: ${serverName}`
                } catch (error) {
                    context.message = `Error: ${error.message}`
                }

                return ChainMiddlewareRunStatus.STOP
            },
            ctx
        )
        .after('lifecycle-handle_command')

    chain
        .middleware(
            'enable_mcp_tool',
            async (session, context) => {
                const {
                    command,
                    options: { toolName }
                } = context

                if (command !== 'enable_mcp_tool')
                    return ChainMiddlewareRunStatus.SKIPPED

                if (!toolName) {
                    context.message = 'Usage: provide tool name'
                    return ChainMiddlewareRunStatus.STOP
                }

                try {
                    const tools = ctx.chatluna_agent.mcp.listTools()
                    const tool = tools.find((t) => t.name === toolName)

                    if (!tool) {
                        context.message = `Tool not found: ${toolName}`
                        return ChainMiddlewareRunStatus.STOP
                    }

                    const newEnabled = !tool.enabled

                    await ctx.chatluna_agent.saveMcpTool({
                        name: toolName,
                        enabled: newEnabled,
                        timeout: tool.timeout,
                        selector: tool.selector
                    })

                    const status = newEnabled ? 'enabled' : 'disabled'
                    context.message = `Tool ${toolName} ${status}`
                } catch (error) {
                    context.message = `Error: ${error.message}`
                }

                return ChainMiddlewareRunStatus.STOP
            },
            ctx
        )
        .after('lifecycle-handle_command')
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
