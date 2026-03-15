import { Context } from 'koishi'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { ToolListChangedNotificationSchema } from '@modelcontextprotocol/sdk/types.js'
import { tool } from '@langchain/core/tools'
import { ChatLunaPlugin } from 'koishi-plugin-chatluna/services/chat'
import { getMessageContent } from 'koishi-plugin-chatluna/utils/string'
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
import { callTool } from '../mcp/tool_call'
import { logger } from '..'

export class ChatLunaAgentMcpService {
    private _tools: Record<string, ToolInfo> = {}
    private _disposers = new Map<string, () => void>()
    private _servers = new Map<string, ServerInfo>()
    private _stopped = false

    constructor(
        public ctx: Context,
        public config: AgentConfig,
        public plugin: ChatLunaPlugin
    ) {}

    async start() {
        this._stopped = false
        this.ctx.logger.info('Starting MCP service')

        const cfgs = this.config.mcp.mcpServers
        if (!cfgs || Object.keys(cfgs).length === 0) {
            this.ctx.logger.warn('No MCP servers available')
            this.ctx.chatluna_agent?.refreshConsoleData()
            return
        }

        await Promise.all(
            Object.entries(cfgs).map(([name, cfg]) => {
                this._servers.set(name, { state: 'idle', attempts: 0 })
                return this._connect(name, cfg)
            })
        )

        this.ctx.logger.info(
            `MCP service started with ${this._disposers.size} tool(s)`
        )
        this.ctx.chatluna_agent?.refreshConsoleData()
    }

    async stop() {
        this._stopped = true

        for (const srv of this._servers.values()) {
            srv.reconnectDispose?.()
            if (srv.client) {
                await srv.client.close().catch(() => {})
            }
        }

        for (const dispose of this._disposers.values()) {
            dispose()
        }

        this._servers.clear()
        this._disposers.clear()
        this._tools = {}
    }

    async reload() {
        const active = Array.from(this._servers.keys())
        await Promise.all(
            active
                .filter((name) => !this.config.mcp.mcpServers[name])
                .map((name) => this._remove(name))
        )

        const names = Object.keys(this.config.mcp.mcpServers)
        if (names.length > 0) {
            await Promise.all(names.map((name) => this.reconnect(name)))
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
            this._servers.set(name, { state: 'reconnecting', attempts: 0 })
        }

        this.ctx.chatluna_agent?.refreshConsoleData()
        await this._drop(name, false)
        await this._connect(name, cfg, true)
    }

    async sync(prev: McpConfig, next: McpConfig) {
        const changed = new Set<string>()

        await Promise.all(
            Object.keys(prev.mcpServers)
                .filter((name) => !next.mcpServers[name])
                .map((name) => this._remove(name))
        )

        for (const [name, srv] of Object.entries(next.mcpServers)) {
            if (
                JSON.stringify(prev.mcpServers[name] ?? null) !==
                JSON.stringify(srv)
            ) {
                changed.add(name)
            }
        }

        for (const name of [
            ...Object.keys(prev.tools),
            ...Object.keys(next.tools)
        ]) {
            if (
                JSON.stringify(prev.tools[name] ?? null) ===
                JSON.stringify(next.tools[name] ?? null)
            ) {
                continue
            }

            const t = this._tools[name]
            if (!t) continue

            const srv = next.mcpServers[t.server]
            const cfg = next.tools[name]

            t.enabled = cfg?.enabled ?? true
            t.selector = cfg?.selector ?? []
            t.timeout = calcTimeout(cfg?.timeout, srv?.timeout)

            if (srv) {
                changed.add(t.server)
            }
        }

        this.ctx.chatluna_agent?.refreshConsoleData()

        if (changed.size > 0) {
            await Promise.all(
                Array.from(changed).map((name) => this.reconnect(name))
            )
        }
    }

    getStatus(): McpStatus {
        const servers: Record<string, McpServerStatus> = {}
        const tools: Record<string, McpToolInfo> = {}

        for (const [name, cfg] of Object.entries(this.config.mcp.mcpServers)) {
            const srv = this._servers.get(name)
            const state = srv?.state ?? 'idle'
            const type = cfg.type ?? (cfg.url ? 'http' : 'stdio')
            const endpoint =
                type === 'stdio' ? (cfg.command ?? '') : (cfg.url ?? '')

            servers[name] = {
                name,
                state,
                stateText: stateText(
                    state,
                    srv?.error,
                    !!srv?.reconnectDispose
                ),
                connected: state === 'connected' && !srv?.error,
                updating: state === 'connecting' || state === 'reconnecting',
                error: srv?.error,
                toolCount: Object.values(this._tools).filter(
                    (t) => t.server === name
                ).length,
                attempts: srv?.attempts ?? 0,
                maxAttempts: 5,
                pendingReconnect: !!srv?.reconnectDispose,
                type,
                endpoint,
                title: srv?.title,
                version: srv?.version,
                icon: srv?.icon
            }
        }

        for (const [name, t] of Object.entries(this._tools)) {
            if (!this.config.mcp.mcpServers[t.server]) continue

            tools[name] = {
                name,
                description: t.description,
                enabled: t.enabled,
                updating: servers[t.server]?.updating ?? false,
                server: t.server,
                timeout: Math.round(t.timeout / 1000),
                selector: t.selector,
                title: t.title,
                icon: t.icon
            }
        }

        return {
            connected: Object.values(servers).some((s) => s.connected),
            servers,
            tools
        }
    }

    listTools() {
        return Object.values(this._tools).filter(
            (t) => this.config.mcp.mcpServers[t.server]
        )
    }

    private async _connect(
        name: string,
        cfg: McpServerConfig,
        reconnecting = false
    ) {
        const srv = this._servers.get(name)
        if (srv?.connectTask) {
            return srv.connectTask
        }

        const task = (async () => {
            this.ctx.logger.debug(`Connecting to server ${name}`)
            const srv = this._servers.get(name)
            if (srv) {
                srv.state = reconnecting ? 'reconnecting' : 'connecting'
                srv.error = undefined
            }
            this.ctx.chatluna_agent?.refreshConsoleData()

            try {
                await this._drop(name, false)

                const transport = createTransport(name, cfg)
                const client = new Client({
                    name: 'ChatLuna',
                    version: '1.0.0',
                    title: 'ChatLuna ModelContext Protocol Client'
                })

                this._setupHandlers(client, name, cfg)
                await client.connect(transport)

                const meta = client.getServerVersion()
                const srv = this._servers.get(name)
                if (srv) {
                    srv.client = client
                    srv.state = 'connected'
                    srv.error = undefined
                    srv.attempts = 0
                    srv.title = meta?.title ?? meta?.name
                    srv.version = meta?.version
                    srv.icon = selectIcon(meta?.icons)
                }

                await this._registerTools(client, name)
                this.ctx.chatluna_agent?.refreshConsoleData()
                this.ctx.logger.debug(`MCP client connected: ${name}`)
                return true
            } catch (error) {
                const text =
                    error instanceof Error ? error.message : String(error)
                await this._fail(name, cfg, text)
                this.ctx.logger.error(
                    `Failed to connect to server ${name}`,
                    error
                )
                return false
            }
        })()

        const srv2 = this._servers.get(name)
        if (srv2) {
            srv2.connectTask = task
        }

        try {
            return await task
        } finally {
            const srv3 = this._servers.get(name)
            if (srv3) {
                srv3.connectTask = undefined
            }
        }
    }

    private _setupHandlers(client: Client, name: string, cfg: McpServerConfig) {
        client.onerror = (error) => {
            if (!this._stopped) {
                this._fail(name, cfg, error.message)
            }
        }

        client.onclose = () => {
            if (!this._stopped) {
                logger.debug(`Client closed: ${name}`)
                this._fail(name, cfg, '连接已断开')
            }
        }

        client.setNotificationHandler(
            ToolListChangedNotificationSchema,
            async () => {
                logger.info(`Tool list changed for server: ${name}`)
                try {
                    const mcpTools = await client.listTools()
                    if (mcpTools.tools.length === 0) {
                        await this._fail(name, cfg, '工具列表为空，等待重连')
                        return
                    }

                    await this._registerTools(client, name)
                    const srv = this._servers.get(name)
                    if (srv) {
                        srv.error = undefined
                        srv.state = 'connected'
                    }
                    this.ctx.chatluna_agent?.refreshConsoleData()
                    logger.info(`Tools updated for server: ${name}`)
                } catch (error) {
                    const text =
                        error instanceof Error ? error.message : String(error)
                    await this._fail(name, cfg, text)
                    logger.error(
                        `Failed to handle tool list change for ${name}`,
                        error
                    )
                }
            }
        )
    }

    private async _fail(name: string, cfg: McpServerConfig, error: string) {
        if (this._stopped) return

        const srv = this._servers.get(name)
        if (srv) {
            srv.error = error
            srv.state = 'error'
        }

        await this._drop(name, false)
        this.ctx.chatluna_agent?.refreshConsoleData()

        const attempts = srv?.attempts ?? 0
        if (attempts >= 5) {
            logger.error(`Max reconnect attempts reached for ${name}`)
            return
        }

        const delay = Math.min(1000 * Math.pow(2, attempts), 30000)
        if (srv) {
            srv.state = 'reconnecting'
        }
        this.ctx.chatluna_agent?.refreshConsoleData()
        logger.info(
            `Scheduling reconnect in ${delay}ms (attempt ${attempts + 1}/5)`
        )

        const dispose = this.ctx.setTimeout(async () => {
            const srv = this._servers.get(name)
            if (srv) {
                srv.reconnectDispose = undefined
                srv.attempts = attempts + 1
            }
            await this._connect(name, cfg, true)
        }, delay)

        if (srv) {
            srv.reconnectDispose = dispose
        }
    }

    private async _registerTools(client: Client, serverName: string) {
        const mcpTools = await client.listTools()
        const serverCfg = this.config.mcp.mcpServers[serverName]
        if (!serverCfg) return

        this._disposeTools(serverName)

        const names = new Set<string>()

        for (const mcpTool of mcpTools.tools) {
            names.add(mcpTool.name)
            const toolCfg = this.config.mcp.tools?.[mcpTool.name]

            this._tools[mcpTool.name] = {
                name: mcpTool.name,
                server: serverName,
                enabled: toolCfg?.enabled ?? true,
                selector: toolCfg?.selector ?? [],
                timeout: calcTimeout(toolCfg?.timeout, serverCfg.timeout),
                description: mcpTool.description ?? '',
                title: mcpTool.title,
                icon: selectIcon(mcpTool.icons)
            }

            const t = this._tools[mcpTool.name]
            if (!t.enabled) {
                logger.debug(`Tool ${mcpTool.name} is disabled`)
                continue
            }

            const langChainTool = tool(
                async (input: Record<string, unknown>) => {
                    return await callTool(
                        serverName,
                        mcpTool.name,
                        client,
                        input,
                        { timeout: t.timeout },
                        undefined,
                        this.ctx,
                        logger
                    )
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

            this._disposers.set(
                mcpTool.name,
                this.ctx.chatluna.platform.registerTool(langChainTool.name, {
                    createTool: () => langChainTool,
                    selector: (history) => {
                        if (t.selector.length === 0) return true
                        return history.some((message) =>
                            t.selector.some((selector) =>
                                getMessageContent(message.content).includes(
                                    selector
                                )
                            )
                        )
                    },
                    meta: {
                        source: 'mcp',
                        group: 'mcp',
                        tags: ['mcp', serverName],
                        isMcp: true,
                        serverName
                    }
                })
            )

            logger.debug(`Tool ${mcpTool.name} registered`)
        }

        for (const [toolName, toolCfg] of Object.entries(this._tools)) {
            if (toolCfg.server === serverName && !names.has(toolName)) {
                delete this._tools[toolName]
            }
        }
    }

    private async _drop(name: string, clearTools = true) {
        const srv = this._servers.get(name)
        if (srv) {
            srv.reconnectDispose?.()
            if (srv.client) {
                srv.client.onclose = undefined
                srv.client.onerror = undefined
                await srv.client.close().catch(() => {})
                srv.client = undefined
            }
        }

        this._disposeTools(name)

        if (clearTools) {
            for (const [toolName, t] of Object.entries(this._tools)) {
                if (t.server === name) {
                    delete this._tools[toolName]
                }
            }
        }
    }

    private async _remove(name: string) {
        await this._drop(name)
        this._servers.delete(name)
        this.ctx.chatluna_agent?.refreshConsoleData()
    }

    private _disposeTools(name: string) {
        for (const [toolName, t] of Object.entries(this._tools)) {
            if (t.server === name) {
                this._disposers.get(toolName)?.()
                this._disposers.delete(toolName)
            }
        }
    }
}

type ToolInfo = {
    name: string
    server: string
    enabled: boolean
    description: string
    timeout: number
    selector: string[]
    title?: string
    icon?: McpIcon
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
}

function selectIcon<T extends { theme?: string }>(icons?: T[]) {
    return icons?.find((i) => i.theme !== 'dark') ?? icons?.[0]
}

function calcTimeout(
    toolTimeout: number | undefined,
    serverTimeout: number | undefined
) {
    return ((toolTimeout ?? 0) || serverTimeout || 60) * 1000
}

function stateText(
    state: McpServerState,
    error: string | undefined,
    pending: boolean
) {
    if (state === 'connected') return '连接正常'
    if (state === 'connecting') return '正在建立连接'
    if (state === 'reconnecting')
        return pending ? '等待自动重连' : '正在重新连接'
    if (state === 'error')
        return error ? `连接失败：${error}` : '连接失败，等待处理'
    return '尚未启动连接'
}
