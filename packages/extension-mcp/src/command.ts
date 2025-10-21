import { Context } from 'koishi'
import { ChainMiddlewareRunStatus } from 'koishi-plugin-chatluna/chains'
import { Config } from './index'

export function apply(ctx: Context, config: Config) {
    const chain = ctx.chatluna.chatChain

    // List MCP tools middleware
    chain
        .middleware(
            'list_mcp_tools',
            async (session, context) => {
                const { command } = context

                if (command !== 'list_mcp_tools')
                    return ChainMiddlewareRunStatus.SKIPPED

                try {
                    const service = ctx.chatluna_mcp
                    if (!service) {
                        context.message = session.text('.service_not_ready')
                        return ChainMiddlewareRunStatus.STOP
                    }

                    const tools = service.globalTools

                    if (Object.keys(tools).length === 0) {
                        context.message = session.text('.empty_tools')
                        return ChainMiddlewareRunStatus.STOP
                    }

                    const messages = [session.text('.list_tools_header')]
                    for (const [name, tool] of Object.entries(tools)) {
                        const selectorText =
                            tool.selector && tool.selector.length > 0
                                ? tool.selector.join(', ')
                                : session.text('.no_selector')
                        const description =
                            tool.description || session.text('.no_description')
                        messages.push(
                            session.text('.tool_name', [name]),
                            session.text('.tool_enabled', [
                                tool.enabled ? '✅' : '❌'
                            ]),
                            session.text('.tool_description', [description]),
                            session.text('.tool_selector', [selectorText]),
                            '---'
                        )
                    }

                    context.message = messages.join('\n')
                } catch (error) {
                    context.message = session.text('.list_error', [
                        error.message
                    ])
                }

                return ChainMiddlewareRunStatus.STOP
            },
            ctx
        )
        .after('lifecycle-handle_command')

    // Add MCP server middleware
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
                    context.message = session.text('.add_usage')
                    return ChainMiddlewareRunStatus.STOP
                }

                try {
                    // Parse the MCP config (Claude Code / VSCode format)
                    const parsedInput = JSON.parse(mcpConfig)

                    // Parse current config
                    let currentConfig
                    try {
                        currentConfig = JSON.parse(config.servers)
                    } catch {
                        currentConfig = { mcpServers: {} }
                    }

                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    let mcpServers: Record<string, any> = {}

                    // Get current servers
                    if (Array.isArray(currentConfig)) {
                        // Convert array to object format
                        mcpServers = currentConfig.reduce(
                            (acc, server, index) => {
                                acc[`server-${index}`] = server
                                return acc
                            },
                            {}
                        )
                    } else if (currentConfig['mcpServers']) {
                        mcpServers = { ...currentConfig['mcpServers'] }
                    } else if (
                        typeof currentConfig === 'object' &&
                        Object.keys(currentConfig)
                    ) {
                        mcpServers = currentConfig
                    }

                    let addedCount = 0
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    const serversToAdd: Record<string, any> = {}

                    // Prepare servers to add
                    if (parsedInput['mcpServers']) {
                        // Claude Code / VSCode format
                        Object.assign(serversToAdd, parsedInput['mcpServers'])
                    } else {
                        // Assume it's a direct server config
                        const serverName = `server-${Date.now()}`
                        serversToAdd[serverName] = parsedInput
                    }

                    // Check for conflicts
                    const conflicts: string[] = []
                    for (const name of Object.keys(serversToAdd)) {
                        if (mcpServers[name]) {
                            conflicts.push(name)
                        }
                    }

                    // Handle conflicts
                    if (conflicts.length > 0) {
                        await session.send(
                            session.text('.add_conflict', [
                                conflicts.join(', ')
                            ])
                        )

                        await session.send(
                            session.text('.add_overwrite_confirm')
                        )

                        const response = await session.prompt()

                        if (!response || response.toUpperCase() !== 'Y') {
                            context.message = session.text('.add_cancelled')
                            return ChainMiddlewareRunStatus.STOP
                        }
                    }

                    // Add new servers
                    for (const [name, serverConfig] of Object.entries(
                        serversToAdd
                    )) {
                        mcpServers[name] = serverConfig
                        addedCount++
                    }

                    // Update config
                    config.servers = JSON.stringify({ mcpServers }, null, 2)

                    context.message = session.text('.add_success', [
                        addedCount.toString()
                    ])
                    // Restart the plugin
                    ctx.scope.parent.scope.update(config, true)
                } catch (error) {
                    context.message = session.text('.add_error', [
                        error.message
                    ])
                }

                return ChainMiddlewareRunStatus.STOP
            },
            ctx
        )
        .after('lifecycle-handle_command')

    // Remove MCP server middleware
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
                    context.message = session.text('.remove_usage')
                    return ChainMiddlewareRunStatus.STOP
                }

                try {
                    const parsedConfig = JSON.parse(config.servers)
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    let mcpServers: Record<string, any> = {}

                    if (Array.isArray(parsedConfig)) {
                        mcpServers = parsedConfig.reduce(
                            (acc, server, index) => {
                                acc[`server-${index}`] = server
                                return acc
                            },
                            {}
                        )
                    } else if (parsedConfig['mcpServers']) {
                        mcpServers = { ...parsedConfig['mcpServers'] }
                    } else {
                        context.message = session.text('.empty_servers')
                        return ChainMiddlewareRunStatus.STOP
                    }

                    if (!mcpServers[serverName]) {
                        context.message = session.text('.server_not_found', [
                            serverName
                        ])
                        return ChainMiddlewareRunStatus.STOP
                    }

                    delete mcpServers[serverName]
                    config.servers = JSON.stringify({ mcpServers }, null, 2)

                    context.message = session.text('.remove_success', [
                        serverName
                    ])

                    // Restart the plugin
                    ctx.scope.parent.scope.update(config, true)
                } catch (error) {
                    context.message = session.text('.remove_error', [
                        error.message
                    ])
                }

                return ChainMiddlewareRunStatus.STOP
            },
            ctx
        )
        .after('lifecycle-handle_command')

    // Enable/Disable MCP tool middleware
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
                    context.message = session.text('.enable_usage')
                    return ChainMiddlewareRunStatus.STOP
                }

                try {
                    const service = ctx.chatluna_mcp
                    if (!service) {
                        context.message = session.text('.service_not_ready')
                        return ChainMiddlewareRunStatus.STOP
                    }

                    const tools = service.globalTools
                    const tool = config.tools[toolName] || tools[toolName]

                    if (!tool) {
                        context.message = session.text('.tool_not_found', [
                            toolName
                        ])
                        return ChainMiddlewareRunStatus.STOP
                    }

                    tool.enabled = !tool.enabled

                    // Update config.tools to persist the change
                    if (!config.tools) {
                        config.tools = {}
                    }
                    config.tools[toolName] = {
                        ...tool
                    }

                    const status = tool.enabled
                        ? session.text('.status_enabled')
                        : session.text('.status_disabled')
                    context.message =
                        session.text('.enable_success', [toolName, status]) +
                        '\n' +
                        session.text('.restart_required')

                    // Restart the plugin
                    ctx.scope.parent.scope.update(config, true)
                } catch (error) {
                    context.message = session.text('.enable_error', [
                        error.message
                    ])
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

export const inject = ['chatluna_mcp']
