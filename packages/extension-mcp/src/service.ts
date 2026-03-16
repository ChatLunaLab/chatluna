/* eslint-disable no-eval */
import { Context, Service } from 'koishi'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import {
    StreamableHTTPClientTransport,
    StreamableHTTPClientTransportOptions
} from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { Config, logger, plugin } from '.'
import { Transport } from '@modelcontextprotocol/sdk/shared/transport.js'
import { tool } from '@langchain/core/tools'
import { ChatLunaPlugin } from 'koishi-plugin-chatluna/services/chat'
import { getMessageContent } from 'koishi-plugin-chatluna/utils/string'
import {
    SSEClientTransport,
    SSEClientTransportOptions
} from '@modelcontextprotocol/sdk/client/sse.js'
import { callTool } from './utils'
import * as fetchType from 'undici/types/fetch'
import { ToolListChangedNotificationSchema } from '@modelcontextprotocol/sdk/types.js'

export class ChatLunaMCPClientService extends Service {
    private _clients: Map<Config['server'][0], Client> = new Map()

    private _globalTools: Record<
        string,
        {
            name: string
            enabled: boolean
            description: string
            timeout?: number
            selector: string[]
        }
    > = {}

    private _registeredTools: Set<string> = new Set()

    private _plugin: ChatLunaPlugin

    private _isStopped: boolean = false

    private _reconnectTimers: Map<Config['server'][0], NodeJS.Timeout> =
        new Map()

    private _maxReconnectAttempts: number = 5
    private _reconnectAttempts: Map<Config['server'][0], number> = new Map()

    constructor(
        public ctx: Context,
        public config: Config
    ) {
        super(ctx, 'chatluna_mcp')

        this._plugin = plugin

        ctx.on('ready', async () => {
            logger.info('Initializing MCP client service')
            const prepared = await this.prepareClients()

            if (!prepared) {
                logger.warn(
                    'Failed to initialize MCP client, skipping tool integration'
                )
                return
            }

            await this.registerClientToolsToSchema()

            const toolLength = await this.registerClientTools()
            logger.info(
                `MCP client initialized successfully with ${toolLength} tool(s) available`
            )
        })
    }

    async prepareClients() {
        const serverConfigs = this._parseServerConfigs()
        if (!serverConfigs || serverConfigs.length === 0) {
            return false
        }

        for (const serverConfig of serverConfigs) {
            await this._connectToServer(serverConfig)
        }

        return this._clients.size > 0
    }

    private _parseServerConfigs(): Config['server'][0][] | null {
        try {
            const parsedConfig = JSON.parse(this.config.servers)
            if (Array.isArray(parsedConfig)) {
                return parsedConfig
            } else if (
                typeof parsedConfig === 'object' &&
                parsedConfig['mcpServers']
            ) {
                return Object.values(
                    parsedConfig['mcpServers'] as Config['server']
                )
            }
            return null
        } catch (error) {
            logger.error(
                'Failed to parse MCP servers configuration',
                error,
                this.config.servers
            )
            return null
        }
    }

    private async _connectToServer(serverConfig: Config['server'][0]) {
        logger.debug(`Connecting to server at ${JSON.stringify(serverConfig)}`)

        try {
            const transport = this._createTransport(serverConfig)
            const client = new Client({
                name: 'ChatLuna',
                version: '1.0.0',
                title: 'ChatLuna ModelContext Protocol Client'
            })

            await client.connect(transport)

            this._clients.set(serverConfig, client)
            this._reconnectAttempts.set(serverConfig, 0)
            logger.debug('MCP client connected at', serverConfig)

            this._setupClientEventHandlers(client, serverConfig)
        } catch (error) {
            this.ctx.logger.error(
                `Failed to connect to server at ${JSON.stringify(
                    serverConfig
                )}`,
                error
            )
        }
    }

    private _setupClientEventHandlers(
        client: Client,
        serverConfig: Config['server'][0]
    ) {
        // Listen for connection close events
        client.onclose = () => {
            if (this._isStopped) {
                logger.debug(
                    `Client closed intentionally: ${JSON.stringify(serverConfig)}`
                )
                return
            }

            logger.warn(
                `Client connection lost: ${JSON.stringify(serverConfig)}, attempting to reconnect...`
            )
            this._clients.delete(serverConfig)
            this._scheduleReconnect(serverConfig)
        }

        // Listen for tool list changes
        client.setNotificationHandler(
            ToolListChangedNotificationSchema,
            async () => {
                logger.info(
                    `Tool list changed for server: ${JSON.stringify(serverConfig)}`
                )
                await this._handleToolListChange(client, serverConfig)
            }
        )
    }

    private async _handleToolListChange(
        client: Client,
        serverConfig: Config['server'][0]
    ) {
        try {
            const mcpTools = await client.listTools()

            if (mcpTools.tools.length === 0) {
                logger.warn(
                    `Tool list is empty for server: ${JSON.stringify(serverConfig)}, triggering full reconnect...`
                )
                await client.close()
                this._clients.delete(serverConfig)
                this._scheduleReconnect(serverConfig)
                return
            }

            // Incremental tool update
            await this._registerToolsForClient(client, serverConfig)
            logger.info(
                `Tools updated for server: ${JSON.stringify(serverConfig)}`
            )
        } catch (error) {
            logger.error(
                `Failed to handle tool list change for server: ${JSON.stringify(serverConfig)}`,
                error
            )
        }
    }

    private _scheduleReconnect(serverConfig: Config['server'][0]) {
        // Clear previous reconnect timer
        const existingTimer = this._reconnectTimers.get(serverConfig)
        if (existingTimer) {
            clearTimeout(existingTimer)
        }

        const attempts = this._reconnectAttempts.get(serverConfig) ?? 0
        if (attempts >= this._maxReconnectAttempts) {
            logger.error(
                `Max reconnect attempts reached for server: ${JSON.stringify(serverConfig)}`
            )
            return
        }

        // Exponential backoff with max 30 seconds
        const delay = Math.min(1000 * Math.pow(2, attempts), 30000)
        logger.info(
            `Scheduling reconnect in ${delay}ms (attempt ${attempts + 1}/${this._maxReconnectAttempts})`
        )

        const timer = setTimeout(async () => {
            this._reconnectTimers.delete(serverConfig)
            this._reconnectAttempts.set(serverConfig, attempts + 1)

            await this._connectToServer(serverConfig)

            // Re-register tools if reconnection successful
            if (this._clients.has(serverConfig)) {
                const client = this._clients.get(serverConfig)
                await this._registerToolsForClient(client, serverConfig)
            }
        }, delay)

        this._reconnectTimers.set(serverConfig, timer)
    }

    private _createTransport(serverConfig: Config['server'][0]): Transport {
        const { command, args, env, cwd, url, type, headers, proxy } =
            serverConfig

        if (url == null) {
            return this._createStdioTransport(command, args, env, cwd)
        } else if (url.includes('sse') || type?.includes('sse')) {
            return this._createSSETransport(url, headers, proxy)
        } else if (url.startsWith('http')) {
            return this._createHTTPTransport(url, headers, proxy)
        }

        throw new Error(`Unsupported transport configuration: ${url}`)
    }

    private _createStdioTransport(
        command: string,
        args?: string[],
        env?: Record<string, string>,
        cwd?: string
    ): Transport {
        const parsedArgs: ConstructorParameters<
            typeof StdioClientTransport
        >[0] = {
            command,
            args,
            env,
            cwd
        }

        if (parsedArgs.args == null && parsedArgs.command != null) {
            const splitted = command.split(' ')
            parsedArgs.command = splitted[0]
            parsedArgs.args = splitted.slice(1)
        }

        for (const key in parsedArgs) {
            if (
                parsedArgs[key] === undefined ||
                parsedArgs[key] === null ||
                parsedArgs[key].toString().trim() === ''
            ) {
                delete parsedArgs[key]
            }
        }

        return new StdioClientTransport(parsedArgs)
    }

    private _createSSETransport(
        url: string,
        headers?: Record<string, string>,
        proxy?: string
    ): Transport {
        const fetchOptions: SSEClientTransportOptions = {
            requestInit: {
                headers: headers ?? {}
            },
            fetch: this._createProxyFetch(proxy)
        }

        return new SSEClientTransport(new URL(url), fetchOptions)
    }

    private _createHTTPTransport(
        url: string,
        headers?: Record<string, string>,
        proxy?: string
    ): Transport {
        const fetchOptions: StreamableHTTPClientTransportOptions = {
            requestInit: {
                headers: headers ?? {}
            },
            fetch: this._createProxyFetch(proxy)
        }

        return new StreamableHTTPClientTransport(new URL(url), fetchOptions)
    }

    private _createProxyFetch(proxy?: string): typeof fetch {
        return ((info: fetchType.RequestInfo, init?: fetchType.RequestInit) =>
            this._plugin.fetch(info, init, proxy)) as unknown as typeof fetch
    }

    async registerClientToolsToSchema() {
        const schemaValueArray: typeof this._globalTools = {}

        for (const entry of this._clients) {
            const [serverConfig, client] = entry

            const mcpTools = await client.listTools()

            for (const mcpTool of mcpTools.tools) {
                const toolConfig = this.config.tools?.[mcpTool.name]
                schemaValueArray[mcpTool.name] = {
                    name: mcpTool.name,
                    enabled: toolConfig?.enabled ?? true,
                    selector: toolConfig?.selector ?? [],
                    timeout:
                        ((toolConfig?.timeout ?? 0) ||
                            serverConfig.timeout ||
                            60) * 1000,
                    description: mcpTool.description ?? ''
                }
            }
        }

        this._globalTools = schemaValueArray
    }

    async registerClientTools() {
        let length = 0
        for (const [serverConfig, client] of this._clients) {
            length += await this._registerToolsForClient(client, serverConfig)
        }
        return length
    }

    private async _registerToolsForClient(
        client: Client,
        serverConfig: Config['server'][0]
    ): Promise<number> {
        const mcpTools = await client.listTools()

        let registeredCount = 0
        for (const mcpTool of mcpTools.tools) {
            const toolConfig = this.config.tools?.[mcpTool.name]

            // Update globalTools schema
            this._globalTools[mcpTool.name] = {
                name: mcpTool.name,
                enabled: toolConfig?.enabled ?? true,
                selector: toolConfig?.selector ?? [],
                timeout:
                    ((toolConfig?.timeout ?? 0) || serverConfig.timeout || 60) *
                    1000,
                description: mcpTool.description ?? ''
            }

            const globalToolConfig = this._globalTools[mcpTool.name]

            if (globalToolConfig?.enabled === false) {
                logger.debug(
                    `Tool ${mcpTool.name} is disabled, skipping registration`
                )
                continue
            }

            // Create LangChain tool
            const langChainTool = tool(
                async (input: Record<string, unknown>) => {
                    return await callTool({
                        client,
                        toolName: mcpTool.name,
                        args: input,
                        serverName: mcpTool.name,
                        config: {
                            timeout: globalToolConfig.timeout
                        },
                        ctx: this.ctx
                    })
                },
                {
                    name: mcpTool.name,
                    description: mcpTool.description,
                    responseFormat: 'content_and_artifact',
                    schema: mcpTool.inputSchema as Parameters<
                        typeof tool
                    >[1]['schema']
                }
            )

            // Register tool (same-name tools will be automatically replaced)
            this._plugin.registerTool(langChainTool.name, {
                description: mcpTool.description,
                createTool: () => langChainTool,
                selector: (history) => {
                    if ((globalToolConfig?.selector?.length || 0) === 0) {
                        return true
                    }

                    return history.some((message) =>
                        globalToolConfig.selector.some((selector) =>
                            getMessageContent(message.content).includes(
                                selector
                            )
                        )
                    )
                }
            })

            // Track registered tools
            const wasRegistered = this._registeredTools.has(mcpTool.name)
            this._registeredTools.add(mcpTool.name)

            if (wasRegistered) {
                logger.debug(`Tool ${mcpTool.name} replaced`)
            } else {
                logger.debug(`Tool ${mcpTool.name} registered`)
                registeredCount++
            }
        }

        return registeredCount
    }

    async stop() {
        this._isStopped = true

        // Clear all reconnect timers
        for (const timer of this._reconnectTimers.values()) {
            clearTimeout(timer)
        }
        this._reconnectTimers.clear()
        this._reconnectAttempts.clear()

        // Close all client connections
        for (const client of this._clients.values()) {
            await client.close()
        }
        this._clients.clear()
        this._registeredTools.clear()
    }

    get clients() {
        return this._clients
    }

    get globalTools() {
        return this._globalTools
    }
}

declare module 'koishi' {
    interface Context {
        chatluna_mcp: ChatLunaMCPClientService
    }
}
