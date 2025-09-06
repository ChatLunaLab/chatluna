/* eslint-disable no-eval */
import { Context, Service } from 'koishi'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { Config, logger } from '.'
import { Transport } from '@modelcontextprotocol/sdk/shared/transport.js'
import { tool } from '@langchain/core/tools'
import { ChatLunaPlugin } from 'koishi-plugin-chatluna/services/chat'
import { getMessageContent } from 'koishi-plugin-chatluna/utils/string'
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js'
import { JsonSchema7Type } from 'zod-to-json-schema'
import { callTool } from './utils'

export class ChatLunaMCPClientService extends Service {
    private _client: Client

    private _plugin: ChatLunaPlugin
    private _globalTools: Record<
        string,
        {
            name: string
            description: string
            enabled: boolean
            selector: string[]
        }
    > = {}

    constructor(
        ctx: Context,
        public config: Config
    ) {
        super(ctx, 'chatluna-mcp-client')

        this._client = new Client({
            name: 'ChatLuna',
            version: '1.0.0'
        })

        this._plugin = new ChatLunaPlugin(
            ctx,
            config as unknown as ChatLunaPlugin.Config,
            'mcp-client',
            false
        )

        this._plugin.registerToService()

        ctx.on('ready', async () => {
            logger.info('Preparing MCP client...')
            await this.prepareClient()
            await this.registerClientToolsToSchema()

            ctx.setTimeout(async () => {
                await this.registerClientTools()
                logger.info(
                    `MCP client found ${Object.keys(this._globalTools).length} tools`
                )
            }, 100)
        })
    }

    async prepareClient() {
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
            throw new Error('Invalid MCP servers configuration')
        }

        for (const serverConfig of serverConfigs) {
            const { command, args, env, cwd, url, type } = serverConfig

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
            } else if (url.includes('sse') || type.includes('sse')) {
                transport = new SSEClientTransport(new URL(url))
            } else if (url.startsWith('http')) {
                transport = new StreamableHTTPClientTransport(new URL(url))
            }

            logger.debug(
                `Connecting to server at ${JSON.stringify(serverConfig)}`
            )
            try {
                await this._client.connect(transport)
                logger.debug('MCP client connected at', serverConfig)
            } catch (error) {
                logger.error(
                    `Failed to connect to server at ${JSON.stringify(
                        serverConfig
                    )}`,
                    error
                )
            }
        }
    }

    async registerClientToolsToSchema() {
        const mcpTools = await this._client.listTools()

        const schemaValueArray: Record<string, Config['tools']['']> = {}

        for (const tool of mcpTools.tools) {
            schemaValueArray[tool.name] = {
                name: tool.name,
                description: tool.description,
                enabled: true,
                selector: []
            }
        }

        this._globalTools = schemaValueArray

        /*    this.ctx.schema.set(
            'tools',
            Schema.dict(
                Schema.object({
                    name: Schema.string(),
                    description: Schema.string(),
                    enabled: Schema.boolean(),
                    selector: Schema.array(Schema.string()).default([])
                })
            ).default(schemaValueArray)
        ) */
    }

    async registerClientTools() {
        const tools = this.config.tools
        const mcpTools = await this._client.listTools()

        // merge tools to global tools
        for (const name in tools) {
            this._globalTools[name] = tools[name]
        }

        for (const name in this._globalTools) {
            const toolConfig = this._globalTools[name]
            const mcpTool = mcpTools.tools.find((t) => t.name === name)

            if (!mcpTool) {
                logger.warn(`Tool ${name} not found in MCP`)
                continue
            }

            const langChainTool = tool(
                async (input: Record<string, unknown>) => {
                    return callTool({
                        client: this.client,
                        toolName: mcpTool.name,
                        args: input,
                        serverName: name,
                        ctx: this.ctx
                    })
                },
                {
                    name: mcpTool.name,
                    description: mcpTool.description,
                    responseFormat: 'content_and_artifact',
                    schema: mcpTool.inputSchema as JsonSchema7Type
                }
            )

            this._plugin.registerTool(langChainTool.name, {
                createTool: async () => langChainTool,
                selector(history) {
                    if (toolConfig.selector.length === 0) {
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
        }
    }

    async stop() {
        await this._client.close()
    }

    get client() {
        return this._client
    }
}

declare module 'koishi' {
    interface Services {
        'chatluna-mcp-client': ChatLunaMCPClientService
    }
}
