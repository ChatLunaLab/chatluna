/** @module service/mcp */

import { Context } from 'koishi'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { ToolListChangedNotificationSchema } from '@modelcontextprotocol/sdk/types.js'
import { AjvJsonSchemaValidator } from '@modelcontextprotocol/sdk/validation/ajv'
import { ChatLunaPlugin } from 'koishi-plugin-chatluna/services/chat'
import {
    AgentConfig,
    McpConfig,
    McpIcon,
    McpServerConfig,
    McpServerState,
    McpServerStatus,
    McpStatus,
    McpToolInfo
} from '../types'
import { createTransport } from '../mcp/transport'
import {
    createMcpCatalogTool,
    createMcpLangChainTool,
    McpGateway,
    ToolInfo
} from '../mcp/tools'
import { logger } from '..'

export class ChatLunaAgentMcpService {
    private _servers = new Map<string, ServerInfo>()
    private _validator = new AjvJsonSchemaValidator()
    private _stopped = false
    private _indexingPromise?: Promise<void>
    private _gateway: McpGateway

    constructor(
        public ctx: Context,
        public config: AgentConfig,
        public plugin: ChatLunaPlugin
    ) {
        this._gateway = new McpGateway({
            ctx: this.ctx,
            getConfig: () => this.config.mcp,
            ensureIndexing: () => this._ensureIndexing(),
            getTool: (server, name) =>
                this._servers.get(server)?.tools.get(name),
            allTools: () => {
                const list: { server: string; tool: ToolInfo }[] = []
                for (const [server, srv] of this._servers) {
                    for (const tool of srv.tools.values()) {
                        list.push({ server, tool })
                    }
                }
                return list
            },
            connectForCall: async (serverName) => {
                let srv = this._servers.get(serverName)
                if (!srv?.client || srv.state !== 'connected') {
                    if ((srv?.attempts ?? 0) >= 5) return undefined
                    if (!srv) {
                        this._servers.set(serverName, {
                            state: 'idle',
                            attempts: 0,
                            tools: new Map()
                        })
                    }
                    const cfg = this.config.mcp.mcpServers[serverName]
                    if (!cfg) return undefined
                    await this._connect(serverName, cfg)
                    srv = this._servers.get(serverName)
                }
                return srv?.client
            },
            validator: this._validator,
            registerTool: (name, description, createTool) =>
                this.ctx.chatluna.platform.registerTool(name, {
                    description,
                    createTool,
                    selector: () => true,
                    meta: {
                        source: 'mcp',
                        group: 'mcp',
                        tags: ['mcp', 'gateway'],
                        isMcp: true,
                        defaultAvailability: {
                            enabled: true,
                            main: true,
                            chatluna: true,
                            characterScope: 'all'
                        }
                    }
                })
        })
    }

    async start() {
        this._stopped = false
        logger.info('Starting MCP service')

        const servers = Object.entries(this.config.mcp.mcpServers)
        if (servers.length === 0) {
            logger.warn('No MCP servers available')
            this.ctx.chatluna_agent?.refreshConsoleData()
            return
        }
        for (const [name] of servers) {
            this._servers.set(name, {
                state: 'idle',
                attempts: 0,
                tools: new Map()
            })
        }

        if ((this.config.mcp.mcpToolMode ?? 'eager') === 'catalog') {
            this._gateway.register()
            this._ensureIndexing()
            logger.info(
                `MCP catalog mode initialized with ${servers.length} server(s)`
            )
        } else {
            Promise.allSettled(
                servers.map(([name, cfg]) => this._connect(name, cfg))
            ).then(() => {
                if (this._stopped) return
                logger.info(
                    `MCP startup finished with ${this._toolCount()} tool(s)`
                )
                this.ctx.chatluna_agent?.refreshConsoleData()
            })
        }
        this.ctx.chatluna_agent?.refreshConsoleData()
    }

    async stop() {
        this._stopped = true
        for (const srv of this._servers.values()) {
            await this._closeClient(srv)
            for (const t of srv.tools.values()) t.dispose?.()
        }
        this._gateway.dispose()
        this._servers.clear()
        this._indexingPromise = undefined
    }

    async reload() {
        await this.stop()
        await this.start()
    }

    async sync(prev: McpConfig, next: McpConfig) {
        if ((prev.mcpToolMode ?? 'eager') !== (next.mcpToolMode ?? 'eager')) {
            await this.reload()
            return
        }

        for (const name of Object.keys(prev.mcpServers)) {
            if (!next.mcpServers[name]) {
                await this._remove(name)
            }
        }

        const refresh = new Map<string, [Client, McpServerConfig]>()
        for (const [name, cfg] of Object.entries(next.tools)) {
            if (
                JSON.stringify(prev.tools[name] ?? null) === JSON.stringify(cfg)
            ) {
                continue
            }
            for (const [serverName, srv] of this._servers) {
                const t = srv.tools.get(name)
                if (!t) continue
                const serverCfg = next.mcpServers[serverName]
                if (srv.client && srv.state === 'connected' && serverCfg) {
                    refresh.set(serverName, [srv.client, serverCfg])
                    continue
                }
                t.enabled = cfg.enabled ?? true
                t.selector = cfg.selector ?? []
                t.timeout =
                    ((cfg.timeout ?? 0) || serverCfg?.timeout || 60) * 1000
            }
        }
        await Promise.all(
            Array.from(refresh, ([name, [client, cfg]]) =>
                this._registerTools(client, name, cfg)
            )
        )

        for (const [name, cfg] of Object.entries(next.mcpServers)) {
            if (
                JSON.stringify(prev.mcpServers[name] ?? null) ===
                JSON.stringify(cfg)
            ) {
                continue
            }
            await this.reconnect(name)
        }
        this.ctx.chatluna_agent?.refreshConsoleData()
    }

    async reconnect(name: string) {
        const cfg = this.config.mcp.mcpServers[name]
        if (!cfg) {
            throw new Error(`Server not found: ${name}`)
        }

        const srv = this._servers.get(name)
        if (srv) {
            srv.reconnectDispose?.()
            srv.attempts = 0
            srv.error = undefined
            srv.state = 'reconnecting'
        } else {
            this._servers.set(name, {
                state: 'reconnecting',
                attempts: 0,
                tools: new Map()
            })
        }

        this.ctx.chatluna_agent?.refreshConsoleData()
        await this._drop(name)
        await this._connect(name, cfg, true)
    }

    getStatus(): McpStatus {
        const servers: Record<string, McpServerStatus> = {}
        const tools: Record<string, McpToolInfo> = {}

        for (const [name, cfg] of Object.entries(this.config.mcp.mcpServers)) {
            const srv = this._servers.get(name)
            const state = srv?.state ?? 'idle'
            const type = cfg.type ?? (cfg.url ? 'http' : 'stdio')

            servers[name] = {
                name,
                state,
                connected: state === 'connected' && !srv?.error,
                updating: state === 'connecting' || state === 'reconnecting',
                error: srv?.error,
                toolCount: srv?.tools.size ?? 0,
                attempts: srv?.attempts ?? 0,
                maxAttempts: 5,
                pendingReconnect: !!srv?.reconnectDispose,
                type,
                endpoint:
                    type === 'stdio' ? (cfg.command ?? '') : (cfg.url ?? ''),
                title: srv?.title,
                version: srv?.version,
                icon: srv?.icon
            }
        }

        for (const [serverName, srv] of this._servers) {
            if (!this.config.mcp.mcpServers[serverName]) continue
            for (const t of srv.tools.values()) {
                tools[t.name] = {
                    name: t.name,
                    description: t.description,
                    enabled: t.enabled,
                    updating: servers[serverName]?.updating ?? false,
                    server: serverName,
                    timeout: Math.round(t.timeout / 1000),
                    selector: t.selector,
                    title: t.title,
                    icon: t.icon
                }
            }
        }

        return {
            connected: Object.values(servers).some((s) => s.connected),
            servers,
            tools
        }
    }

    listTools() {
        return Array.from(this._servers.entries()).flatMap(
            ([serverName, srv]) =>
                this.config.mcp.mcpServers[serverName]
                    ? Array.from(srv.tools.values())
                    : []
        )
    }

    private async _connect(
        name: string,
        cfg: McpServerConfig,
        reconnecting = false
    ) {
        const srv = this._servers.get(name)
        if (!srv || this._stopped) return false
        if (srv.connectTask) return srv.connectTask
        if (srv.client && srv.state === 'connected') return true

        srv.state = reconnecting ? 'reconnecting' : 'connecting'
        srv.error = undefined
        this.ctx.chatluna_agent?.refreshConsoleData()

        const client = new Client({
            name: 'ChatLuna',
            version: '1.0.0',
            title: 'ChatLuna ModelContext Protocol Client'
        })
        srv.client = client
        this._setupHandlers(client, name, cfg)

        const task = (async () => {
            logger.debug(`Connecting to server ${name}`)
            const startupTimeout = calcStartupTimeout(cfg)
            let clearTimer: (() => void) | undefined
            const timeout = new Promise<never>((_resolve, reject) => {
                clearTimer = this.ctx.setTimeout(() => {
                    reject(
                        new Error(
                            `MCP server startup timed out after ${startupTimeout}ms`
                        )
                    )
                }, startupTimeout)
            })

            try {
                try {
                    await Promise.race([
                        client.connect(
                            createTransport(name, cfg, this.plugin),
                            { timeout: startupTimeout }
                        ),
                        timeout
                    ])
                } finally {
                    clearTimer?.()
                }

                const meta = client.getServerVersion()
                if (!this._isCurrent(name, client)) {
                    await client.close().catch(() => {})
                    return false
                }

                srv.title = meta?.title ?? meta?.name
                srv.version = meta?.version
                srv.icon = selectIcon(meta?.icons)

                const toolCount = await this._registerTools(client, name, cfg)
                if (toolCount == null || !this._isCurrent(name, client)) {
                    await client.close().catch(() => {})
                    return false
                }

                srv.state = 'connected'
                srv.error = undefined
                srv.attempts = 0
                this.ctx.chatluna_agent?.refreshConsoleData()
                logger.info(
                    `MCP client connected: ${name} (${toolCount} tool(s))`
                )
                return true
            } catch (error) {
                if (this._isCurrent(name, client)) {
                    await this._fail(
                        name,
                        cfg,
                        error instanceof Error ? error.message : String(error),
                        client
                    )
                    logger.error(`Failed to connect to server ${name}`, error)
                } else {
                    await client.close().catch(() => {})
                }
                return false
            }
        })()

        srv.connectTask = task
        try {
            return await task
        } finally {
            if (this._servers.get(name)?.connectTask === task) {
                this._servers.get(name)!.connectTask = undefined
            }
        }
    }

    private _setupHandlers(client: Client, name: string, cfg: McpServerConfig) {
        const handleError = (error: string, reason: string) => {
            if (this._isCurrent(name, client)) {
                this._fail(name, cfg, error, client).catch((e) =>
                    logger.error(`Failed to handle ${reason} for ${name}`, e)
                )
            }
        }
        client.onerror = (error) => handleError(error.message, 'MCP error')
        client.onclose = () => handleError('连接已断开', 'MCP close')

        client.setNotificationHandler(
            ToolListChangedNotificationSchema,
            async () => {
                logger.info(`Tool list changed for server: ${name}`)
                try {
                    const count = await this._registerTools(client, name, cfg)
                    if (count == null) return
                    const srv = this._servers.get(name)
                    if (srv?.client === client) {
                        srv.error = undefined
                        srv.state = 'connected'
                    }
                    this.ctx.chatluna_agent?.refreshConsoleData()
                    logger.info(`Tools updated for server: ${name}`)
                } catch (error) {
                    await this._fail(
                        name,
                        cfg,
                        error instanceof Error ? error.message : String(error),
                        client
                    )
                    logger.error(
                        `Failed to handle tool list change for ${name}`,
                        error
                    )
                }
            }
        )
    }

    private async _fail(
        name: string,
        cfg: McpServerConfig,
        error: string,
        client: Client
    ) {
        if (this._stopped) return

        const srv = this._servers.get(name)
        if (srv?.client !== client) return
        srv.error = error
        srv.state = 'error'

        await this._drop(name)
        this.ctx.chatluna_agent?.refreshConsoleData()

        if (this._stopped || !this.config.mcp.mcpServers[name]) return

        const attempts = srv.attempts
        if (attempts >= 5) {
            logger.error(`Max reconnect attempts reached for ${name}`)
            return
        }

        srv.state = 'reconnecting'
        const delay = Math.min(1000 * Math.pow(2, attempts), 30000)
        logger.info(
            `Scheduling reconnect in ${delay}ms (attempt ${attempts + 1}/5)`
        )

        srv.reconnectDispose = this.ctx.setTimeout(async () => {
            const current = this._servers.get(name)
            if (current) {
                current.reconnectDispose = undefined
                current.attempts = attempts + 1
            }
            const currentCfg = this.config.mcp.mcpServers[name]
            if (!currentCfg || this._stopped) return false
            await this._connect(name, currentCfg, true)
        }, delay)
        this.ctx.chatluna_agent?.refreshConsoleData()
    }

    private async _registerTools(
        client: Client,
        serverName: string,
        cfg: McpServerConfig
    ): Promise<number | undefined> {
        const mcpTools = await client.listTools(undefined, {
            timeout: calcStartupTimeout(cfg)
        })
        if (!this._isCurrent(serverName, client)) return
        const serverCfg = this.config.mcp.mcpServers[serverName]
        if (!serverCfg) return

        const srv = this._servers.get(serverName)
        if (!srv) return

        this.ctx.chatluna_agent?.permission.invalidateCache()
        this._disposeTools(serverName)

        for (const mcpTool of mcpTools.tools) {
            const toolCfg = this.config.mcp.tools?.[mcpTool.name]

            const t: ToolInfo = {
                name: mcpTool.name,
                enabled: toolCfg?.enabled ?? true,
                selector: toolCfg?.selector ?? [],
                timeout:
                    ((toolCfg?.timeout ?? 0) || serverCfg.timeout || 60) * 1000,
                description: mcpTool.description ?? '',
                title: mcpTool.title,
                icon: selectIcon(mcpTool.icons),
                catalog: createMcpCatalogTool({
                    name: mcpTool.name,
                    description: mcpTool.description,
                    inputSchema: mcpTool.inputSchema as Record<string, unknown>
                })
            }

            srv.tools.set(mcpTool.name, t)
            if (
                !t.enabled ||
                (this.config.mcp.mcpToolMode ?? 'eager') === 'catalog'
            ) {
                continue
            }

            createMcpLangChainTool(serverName, mcpTool, t, client, this.ctx)
        }

        if ((this.config.mcp.mcpToolMode ?? 'eager') === 'catalog') {
            this._gateway.register()
        }

        this.ctx.chatluna_agent?.permission.invalidateCache()
        return mcpTools.tools.length
    }

    private _toolCount() {
        return Array.from(this._servers.values()).reduce(
            (n, srv) => n + srv.tools.size,
            0
        )
    }

    private _isCurrent(name: string, client: Client) {
        const srv = this._servers.get(name)
        return !this._stopped && srv?.client === client
    }

    private async _closeClient(srv: ServerInfo) {
        srv.reconnectDispose?.()
        srv.reconnectDispose = undefined
        srv.connectTask = undefined
        const client = srv.client
        srv.client = undefined
        if (client) {
            client.onclose = undefined
            client.onerror = undefined
            await Promise.race([
                client.close().catch(() => {}),
                new Promise<void>((resolve) =>
                    this.ctx.setTimeout(resolve, 5000)
                )
            ])
        }
    }

    private async _drop(name: string) {
        const srv = this._servers.get(name)
        if (srv) {
            await this._closeClient(srv)
        }

        if ((this.config.mcp.mcpToolMode ?? 'eager') !== 'catalog') {
            this._disposeTools(name)
        }

        this.ctx.chatluna_agent?.permission.invalidateCache()
    }

    private async _remove(name: string) {
        await this._drop(name)
        this._servers.delete(name)
        if (Object.keys(this.config.mcp.mcpServers).length === 0) {
            this._gateway.dispose()
        }
        this.ctx.chatluna_agent?.refreshConsoleData()
    }

    private _disposeTools(name: string) {
        const srv = this._servers.get(name)
        if (!srv) return
        for (const [toolName, t] of srv.tools) {
            const current =
                this.ctx.chatluna.platform.getToolRegistry()[toolName]
            if (!current || current.meta?.serverName === name) {
                t.dispose?.()
            }
            t.dispose = undefined
        }
        srv.tools.clear()
    }

    private _ensureIndexing() {
        if (this._indexingPromise) return this._indexingPromise
        const task = this._indexAllServers().finally(() => {
            if (this._toolCount() === 0 && this._indexingPromise === task) {
                this._indexingPromise = undefined
            }
        })
        this._indexingPromise = task
        return task
    }

    private async _indexAllServers() {
        if (this._stopped) return

        logger.info('Starting MCP server indexing...')
        const startTime = Date.now()

        const tasks = Object.entries(this.config.mcp.mcpServers).map(
            ([name, cfg]) =>
                this._connect(name, cfg).then((success) => {
                    if (success) logger.debug(`Indexed MCP server: ${name}`)
                })
        )

        await Promise.allSettled(tasks)

        logger.info(
            `MCP indexing complete: ${this._toolCount()} tool(s) from ${this._servers.size} server(s) in ${Date.now() - startTime}ms`
        )
        this.ctx.chatluna_agent?.refreshConsoleData()
    }
}

type ServerInfo = {
    client?: Client
    state: McpServerState
    error?: string
    attempts: number
    reconnectDispose?: () => void
    connectTask?: Promise<boolean>
    title?: string
    version?: string
    icon?: McpIcon
    tools: Map<string, ToolInfo>
}

function selectIcon<T extends { theme?: string }>(icons?: T[]) {
    return icons?.find((i) => i.theme !== 'dark') ?? icons?.[0]
}

function calcStartupTimeout(server: McpServerConfig) {
    return Math.max(1, server.startupTimeout ?? 20) * 1000
}
