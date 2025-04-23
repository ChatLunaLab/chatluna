import { Context, Service } from 'koishi'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { Config, logger } from '.'
import { Transport } from '@modelcontextprotocol/sdk/shared/transport.js'

export class ChatLunaMCPClientService extends Service {
    private _client: Client

    constructor(
        ctx: Context,
        public config: Config
    ) {
        super(ctx, 'chatluna-mcp-client')

        this._client = new Client({
            name: 'ChatLuna',
            version: '1.0.0'
        })

        ctx.on('ready', async () => {
            logger.info('Preparing MCP client...')
            await this.prepareClient()
        })
    }

    async prepareClient() {
        const serverConfigs = this.config.server

        for (const serverConfig of serverConfigs) {
            const { type, stdio, url } = serverConfig

            let transport: Transport
            if (type === 'stdio') {
                const args: ConstructorParameters<
                    typeof StdioClientTransport
                >[0] = {
                    command: stdio.command,
                    args: stdio.args,
                    env: stdio.env,
                    cwd: stdio.cwd
                }

                for (const key in args) {
                    if (
                        args[key] === undefined ||
                        args[key] === null ||
                        args[key].toString().trim() === ''
                    ) {
                        delete args[key]
                    }
                }

                transport = new StdioClientTransport(args)
            } else if (type === 'sse') {
                transport = new SSEClientTransport(new URL(url))
            } else if (type === 'stream-http') {
                transport = new StreamableHTTPClientTransport(new URL(url))
            }

            logger.debug(
                `Connecting to ${type} server at ${JSON.stringify(serverConfig)}`
            )
            try {
                await this._client.connect(transport)
                console.log(await this._client.listTools())
            } catch (error) {
                logger.error(
                    `Failed to connect to ${type} server at ${JSON.stringify(
                        serverConfig
                    )}`
                )
            }
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
