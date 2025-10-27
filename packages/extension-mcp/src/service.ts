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

    private _plugin: ChatLunaPlugin

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
        let serverConfigs: Config['server'][0][] = []

        try {
            const parsedConfig = JSON.parse(this.config.servers)
            if (Array.isArray(parsedConfig)) {
                serverConfigs = parsedConfig
            } else if (
                typeof parsedConfig === 'object' &&
                parsedConfig['mcpServers']
            ) {
                serverConfigs = Object.values(
                    parsedConfig['mcpServers'] as Config['server']
                )
            }
        } catch (error) {
            logger.error(
                'Failed to parse MCP servers configuration',
                error,
                this.config.servers
            )
            return false
        }

        if (!serverConfigs.length) {
            return false
        }

        for (const serverConfig of serverConfigs) {
            const { command, args, env, cwd, url, type, headers, proxy } =
                serverConfig

            let transport: Transport
            if (url == null) {
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

                transport = new StdioClientTransport(parsedArgs)
            } else if (url.includes('sse') || type?.includes('sse')) {
                const fetchOptions: SSEClientTransportOptions = {
                    requestInit: {
                        headers: headers ?? {}
                    },
                    fetch: ((
                        info: fetchType.RequestInfo,
                        init?: fetchType.RequestInit
                    ) =>
                        this._plugin.fetch(
                            info,
                            init,
                            proxy
                        )) as unknown as typeof fetch
                }

                transport = new SSEClientTransport(new URL(url), fetchOptions)
            } else if (url.startsWith('http')) {
                const fetchOptions: StreamableHTTPClientTransportOptions = {
                    requestInit: {
                        headers: headers ?? {}
                    },
                    fetch: ((
                        info: fetchType.RequestInfo,
                        init?: fetchType.RequestInit
                    ) =>
                        this._plugin.fetch(
                            info,
                            init,
                            proxy
                        )) as unknown as typeof fetch
                }

                transport = new StreamableHTTPClientTransport(
                    new URL(url),
                    fetchOptions
                )
            }

            logger.debug(
                `Connecting to server at ${JSON.stringify(serverConfig)}`
            )

            try {
                const client = new Client({
                    name: 'ChatLuna',
                    version: '1.0.0',
                    title: 'ChatLuna ModelContext Protocol Client',
                    description:
                        'A client for the ChatLuna ModelContext Protocol'
                })

                await client.connect(transport)

                this._clients.set(serverConfig, client)
                logger.debug('MCP client connected at', serverConfig)
            } catch (error) {
                this.ctx.logger.error(
                    `Failed to connect to server at ${JSON.stringify(
                        serverConfig
                    )}`,
                    error
                )
            }
        }

        return this._clients.size > 0
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
        const forkTools = { ...this._globalTools }

        const toolToClientMap: Record<
            string,
            [Client, Awaited<ReturnType<Client['listTools']>>['tools'][number]]
        > = {}

        for (const client of this._clients.values()) {
            const mcpTools = await client.listTools()
            for (const tool of mcpTools.tools) {
                toolToClientMap[tool.name] = [client, tool] as const
            }
        }

        let length = 0
        for (const name in forkTools) {
            const toolConfig = forkTools[name]
            const mapping = toolToClientMap[name]

            if (!mapping) {
                logger.warn(`Tool ${name} not found in MCP`)
                continue
            }

            const [client, mcpTool] = mapping

            if (toolConfig?.enabled === false) {
                logger.debug(`Tool ${name} is disabled, skipping registration`)
                continue
            }

            const langChainTool = tool(
                async (input: Record<string, unknown>) => {
                    return callTool({
                        client,
                        toolName: mcpTool.name,
                        args: input,
                        serverName: name,
                        config: {
                            timeout: toolConfig.timeout
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

            this._plugin.registerTool(langChainTool.name, {
                createTool: () => langChainTool,
                selector(history) {
                    if ((toolConfig?.selector?.length || 0) === 0) {
                        return true
                    }

                    return history.some((message) =>
                        toolConfig.selector.some((selector) =>
                            getMessageContent(message.content).includes(
                                selector
                            )
                        )
                    )
                }
            })

            length++
        }

        return length
    }

    async stop() {
        for (const client of this._clients.values()) {
            await client.close()
        }
        this._clients.clear()
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
