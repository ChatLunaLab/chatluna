import { Context } from 'koishi'
import { Config } from '.'

export function apply(ctx: Context, config: Config) {
    ctx.command('chatluna.mcp', 'MCP 工具管理相关命令')

    // List command
    ctx.command('chatluna.mcp.list', '列出所有 MCP 工具')
        .option('raw', '-r 列出原始的 MCP 服务器配置')
        .action(async ({ session, options }) => {
            if (options.raw) {
                // List raw MCP servers
                try {
                    const parsedConfig = JSON.parse(config.servers)
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    let servers: Record<string, any> = {}

                    if (Array.isArray(parsedConfig)) {
                        servers = parsedConfig.reduce((acc, server, index) => {
                            acc[`server-${index}`] = server
                            return acc
                        }, {})
                    } else if (parsedConfig['mcpServers']) {
                        servers = parsedConfig['mcpServers']
                    } else {
                        await session.send(session.text('.empty_servers'))
                        return
                    }

                    if (Object.keys(servers).length === 0) {
                        await session.send(session.text('.empty_servers'))
                        return
                    }

                    const messages = [session.text('.list_servers_header')]
                    for (const [name, serverConfig] of Object.entries(
                        servers
                    )) {
                        messages.push(
                            session.text('.server_name', [name]),
                            session.text('.server_config', [
                                JSON.stringify(serverConfig, null, 2)
                            ]),
                            '---'
                        )
                    }

                    await session.send(messages.join('\n'))
                } catch (error) {
                    await session.send(session.text('.parse_error'))
                }
            } else {
                // List tools
                try {
                    const service = ctx.chatluna_mcp
                    if (!service) {
                        await session.send(session.text('.service_not_ready'))
                        return
                    }

                    const tools = service['_globalTools']

                    if (Object.keys(tools).length === 0) {
                        await session.send(session.text('.empty_tools'))
                        return
                    }

                    const messages = [session.text('.list_tools_header')]
                    for (const [name, tool] of Object.entries(tools)) {
                        const selectorText =
                            tool.selector && tool.selector.length > 0
                                ? tool.selector.join(', ')
                                : session.text('.no_selector')
                        messages.push(
                            session.text('.tool_name', [name]),
                            session.text('.tool_enabled', [
                                tool.enabled ? '✓' : '✗'
                            ]),
                            session.text('.tool_selector', [selectorText]),
                            '---'
                        )
                    }

                    await session.send(messages.join('\n'))
                } catch (error) {
                    await session.send(
                        session.text('.list_error', [error.message])
                    )
                }
            }
        })

    // Add command
    ctx.command('chatluna.mcp.add <mcpConfig:text>', '添加 MCP 服务器', {
        authority: 3
    }).action(async ({ session }, mcpConfig) => {
        if (!mcpConfig) {
            await session.send(session.text('.add_usage'))
            return
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
                mcpServers = currentConfig.reduce((acc, server, index) => {
                    acc[`server-${index}`] = server
                    return acc
                }, {})
            } else if (currentConfig['mcpServers']) {
                mcpServers = { ...currentConfig['mcpServers'] }
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
                    session.text('.add_conflict', [conflicts.join(', ')])
                )

                await session.send(session.text('.add_overwrite_confirm'))

                const response = await session.prompt()

                if (!response || response.toUpperCase() !== 'Y') {
                    await session.send(session.text('.add_cancelled'))
                    return
                }
            }

            // Add new servers
            for (const [name, serverConfig] of Object.entries(serversToAdd)) {
                mcpServers[name] = serverConfig
                addedCount++
            }

            // Update config
            config.servers = JSON.stringify({ mcpServers }, null, 2)

            await session.send(
                session.text('.add_success', [addedCount.toString()])
            )

            ctx.scope.parent.scope.update(config, true)
        } catch (error) {
            await session.send(session.text('.add_error', [error.message]))
        }
    })

    // Remove command
    ctx.command('chatluna.mcp.remove <serverName:string>', '移除 MCP 服务器', {
        authority: 3
    }).action(async ({ session }, serverName) => {
        if (!serverName) {
            await session.send(session.text('.remove_usage'))
            return
        }

        try {
            const parsedConfig = JSON.parse(config.servers)
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            let mcpServers: Record<string, any> = {}

            if (Array.isArray(parsedConfig)) {
                mcpServers = parsedConfig.reduce((acc, server, index) => {
                    acc[`server-${index}`] = server
                    return acc
                }, {})
            } else if (parsedConfig['mcpServers']) {
                mcpServers = { ...parsedConfig['mcpServers'] }
            } else {
                await session.send(session.text('.empty_servers'))
                return
            }

            if (!mcpServers[serverName]) {
                await session.send(
                    session.text('.server_not_found', [serverName])
                )
                return
            }

            delete mcpServers[serverName]
            config.servers = JSON.stringify({ mcpServers }, null, 2)

            await session.send(session.text('.remove_success', [serverName]))

            ctx.scope.parent.scope.update(config, true)
        } catch (error) {
            await session.send(session.text('.remove_error', [error.message]))
        }
    })

    // Enable/Disable tool
    ctx.command(
        'chatluna.mcp.enable <toolName:string>',
        '启用或禁用 MCP 工具',
        {
            authority: 3
        }
    ).action(async ({ session }, toolName) => {
        if (!toolName) {
            await session.send(session.text('.enable_usage'))
            return
        }

        try {
            const service = ctx['chatluna-mcp-client']
            if (!service) {
                await session.send(session.text('.service_not_ready'))
                return
            }

            const tools = service['_globalTools']
            const tool = tools[toolName]

            if (!tool) {
                await session.send(session.text('.tool_not_found', [toolName]))
                return
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
            await session.send(
                session.text('.enable_success', [toolName, status])
            )
            ctx.scope.parent.scope.update(config, true)
        } catch (error) {
            await session.send(session.text('.enable_error', [error.message]))
        }
    })
}

export const inject = ['chatluna_mcp']
