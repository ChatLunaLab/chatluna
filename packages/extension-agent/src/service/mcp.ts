/** @module service/mcp */

import { Context } from 'koishi'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { ToolListChangedNotificationSchema } from '@modelcontextprotocol/sdk/types.js'
import { AjvJsonSchemaValidator } from '@modelcontextprotocol/sdk/validation/ajv'
import { RunnableConfig } from '@langchain/core/runnables'
import { tool } from '@langchain/core/tools'
import { z } from 'zod'
import { applyToolMask, ToolMask } from 'koishi-plugin-chatluna/llm-core/agent'
import { ClientConfig } from 'koishi-plugin-chatluna/llm-core/platform/config'
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
import {
    createMcpCatalogSchemaResult,
    createMcpCatalogSummaryResult,
    createMcpCatalogTool,
    McpCatalogTool,
    scoreMcpCatalogTool,
    validateMcpArguments
} from '../mcp/catalog'
import { ToolException } from '../mcp/types'
import { type Config, logger } from '..'

export class ChatLunaAgentMcpService {
    private _tools: Record<string, ToolInfo> = {}
    private _definitions = new Map<string, ToolInfo>()
    private _disposers = new Map<string, () => void>()
    private _servers = new Map<string, ServerInfo>()
    private _gatewayDisposers: (() => void)[] = []
    private _validator = new AjvJsonSchemaValidator()
    private _serverOperations = new Map<string, Promise<void>>()
    private _activeCalls = new Map<string, number>()
    private _activeCallWaiters = new Map<string, Set<() => void>>()
    private _stopped = false
    private _indexing = false
    private _indexingPromise?: Promise<void>

    constructor(
        public ctx: Context,
        public config: AgentConfig,
        public plugin: ChatLunaPlugin<ClientConfig, Config>
    ) {}

    /**
     * Start the MCP service. In catalog mode, initializes server records without connecting.
     * In eager mode, connects to all configured servers immediately.
     */
    async start() {
        this._stopped = false
        logger.info('Starting MCP service')

        if (
            !this.config.mcp.mcpServers ||
            Object.keys(this.config.mcp.mcpServers).length === 0
        ) {
            logger.warn('No MCP servers available')
            this.ctx.chatluna_agent?.refreshConsoleData()
            return
        }

        // catalog 模式：仅初始化服务器状态，不连接
        if (this.plugin.config.mcpToolMode === 'catalog') {
            for (const name of Object.keys(this.config.mcp.mcpServers)) {
                this._servers.set(name, {
                    state: 'idle',
                    attempts: 0
                })
            }
            this._registerGateways()
            logger.info(
                `MCP catalog mode initialized with ${this._servers.size} server(s). ` +
                    `Servers will be indexed on first search.`
            )
            this.ctx.chatluna_agent?.refreshConsoleData()
            return
        }

        // eager 模式：启动时连接所有服务器
        const tasks = Object.entries(this.config.mcp.mcpServers).map(
            ([name, cfg]) => {
                this._servers.set(name, {
                    state: 'idle',
                    attempts: 0
                })
                return this._enqueueServerOperation(name, () =>
                    this._connect(name, cfg)
                )
            }
        )

        this._runInBackground(tasks, 'MCP startup')
        this.ctx.chatluna_agent?.refreshConsoleData()
    }

    /**
     * Stop the MCP service, waiting for active calls to complete and closing all connections.
     */
    async stop() {
        this._stopped = true
        this._indexing = false
        const names = Array.from(this._servers.keys())

        await Promise.allSettled(this._serverOperations.values())
        await Promise.all(names.map((name) => this._waitForActiveCalls(name)))

        for (const srv of this._servers.values()) {
            srv.reconnectDispose?.()
            srv.connectTask = undefined
            const client = srv.client
            srv.client = undefined
            if (client) {
                client.onclose = undefined
                client.onerror = undefined
                await client.close().catch(() => {})
            }
        }

        for (const dispose of this._disposers.values()) {
            dispose()
        }
        this._disposeGateways()

        this._servers.clear()
        this._disposers.clear()
        this._definitions.clear()
        this._serverOperations.clear()
        this._activeCalls.clear()
        for (const waiters of this._activeCallWaiters.values()) {
            for (const resolve of waiters) resolve()
        }
        this._activeCallWaiters.clear()
        this._tools = {}
        this._indexingPromise = undefined
    }

    /**
     * Reload the MCP service, removing deleted servers and reconnecting to existing/new ones.
     */
    async reload() {
        await Promise.all(
            Array.from(this._servers.keys())
                .filter((name) => !this.config.mcp.mcpServers[name])
                .map((name) => this._remove(name))
        )

        const names = Object.keys(this.config.mcp.mcpServers)
        if (names.length === 0) {
            this._disposeGateways()
            this.ctx.chatluna_agent?.refreshConsoleData()
            return
        }

        if (this.plugin.config.mcpToolMode === 'catalog') {
            this._registerGateways()
        }
        this._runInBackground(
            names.map((name) => this.reconnect(name)),
            'MCP reload'
        )
        this.ctx.chatluna_agent?.refreshConsoleData()
    }

    /**
     * Reconnect to a specific MCP server, resetting retry attempts and error state.
     * @param name - The server name to reconnect
     */
    async reconnect(name: string) {
        return await this._enqueueServerOperation(name, () =>
            this._reconnectNow(name)
        )
    }

    private async _reconnectNow(name: string) {
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
                attempts: 0
            })
        }

        this.ctx.chatluna_agent?.refreshConsoleData()
        await this._drop(name, false)
        await this._connect(name, cfg, true)
    }

    /**
     * Sync MCP configuration changes by stopping and restarting the service.
     * @param _prev - Previous configuration (unused)
     * @param _next - Next configuration (unused)
     */
    async sync(_prev: McpConfig, _next: McpConfig) {
        await this.stop()
        await this.start()
    }

    /**
     * Get the current status of all MCP servers and tools.
     * @returns Status object containing server states and tool information
     */
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
                endpoint:
                    type === 'stdio' ? (cfg.command ?? '') : (cfg.url ?? ''),
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

    /**
     * List all available MCP tools from connected servers.
     * @returns Array of tool information objects
     */
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
        if (!srv || this._stopped) {
            return false
        }

        srv.state = reconnecting ? 'reconnecting' : 'connecting'
        srv.error = undefined
        this.ctx.chatluna_agent?.refreshConsoleData()

        const client = new Client({
            name: 'ChatLuna',
            version: '1.0.0',
            title: 'ChatLuna ModelContext Protocol Client'
        })
        srv.client = client

        const task = (async () => {
            logger.debug(`Connecting to server ${name}`)
            const startupTimeout = calcStartupTimeout(cfg)
            this._setupHandlers(client, name, cfg)
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
            const current = this._servers.get(name)
            if (current?.connectTask === task) {
                current.connectTask = undefined
            }
        }
    }

    private _setupHandlers(client: Client, name: string, cfg: McpServerConfig) {
        client.onerror = (error) => {
            if (this._isCurrent(name, client)) {
                this._fail(name, cfg, error.message, client).catch((error) => {
                    logger.error(
                        `Failed to handle MCP error for ${name}`,
                        error
                    )
                })
            }
        }

        client.onclose = () => {
            if (this._isCurrent(name, client)) {
                logger.debug(`Client closed: ${name}`)
                this._fail(name, cfg, '连接已断开', client).catch((error) => {
                    logger.error(
                        `Failed to handle MCP close for ${name}`,
                        error
                    )
                })
            }
        }

        client.setNotificationHandler(
            ToolListChangedNotificationSchema,
            async () => {
                logger.info(`Tool list changed for server: ${name}`)
                try {
                    const toolCount = await this._enqueueServerOperation(
                        name,
                        async () => {
                            if (!this._isCurrent(name, client)) return
                            return await this._registerTools(client, name, cfg)
                        }
                    )
                    if (toolCount == null) {
                        return
                    }
                    if (toolCount === 0) {
                        await this._fail(
                            name,
                            cfg,
                            '工具列表为空，等待重连',
                            client
                        )
                        return
                    }

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
        if (srv?.client !== client) {
            return
        }
        srv.error = error
        srv.state = 'error'

        await this._drop(name, false)
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

        const dispose = this.ctx.setTimeout(async () => {
            const srv = this._servers.get(name)
            if (srv) {
                srv.reconnectDispose = undefined
                srv.attempts = attempts + 1
            }
            await this._enqueueServerOperation(name, async () => {
                const current = this.config.mcp.mcpServers[name]
                if (!current || this._stopped) return false
                return await this._connect(name, current, true)
            })
        }, delay)

        srv.reconnectDispose = dispose
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
        if (!this._isCurrent(serverName, client)) {
            return
        }
        const serverCfg = this.config.mcp.mcpServers[serverName]
        if (!serverCfg) return

        this.ctx.chatluna_agent?.permission.invalidateCache()
        this._disposeTools(serverName)
        for (const [id, t] of this._definitions) {
            if (t.server === serverName) {
                this._definitions.delete(id)
            }
        }

        const names = new Set<string>()
        const registered: string[] = []
        const disabled: string[] = []

        for (const mcpTool of mcpTools.tools) {
            names.add(mcpTool.name)
            const toolCfg = this.config.mcp.tools?.[mcpTool.name]

            const t: ToolInfo = {
                name: mcpTool.name,
                server: serverName,
                enabled: toolCfg?.enabled ?? true,
                selector: toolCfg?.selector ?? [],
                timeout: calcTimeout(toolCfg?.timeout, serverCfg.timeout),
                description: mcpTool.description ?? '',
                title: mcpTool.title,
                icon: selectIcon(mcpTool.icons),
                catalog: createMcpCatalogTool({
                    name: mcpTool.name,
                    title: mcpTool.title,
                    description: mcpTool.description,
                    inputSchema: mcpTool.inputSchema as Record<string, unknown>
                })
            }

            this._tools[mcpTool.name] = t
            this._definitions.set(toolId(serverName, mcpTool.name), t)
            if (!t.enabled) {
                disabled.push(mcpTool.name)
                continue
            }

            if (this.plugin.config.mcpToolMode === 'catalog') {
                registered.push(mcpTool.name)
                continue
            }

            const langChainTool = tool(
                async (input: unknown) => {
                    return await callTool(
                        serverName,
                        mcpTool.name,
                        client,
                        input as Record<string, unknown>,
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
                toolId(serverName, mcpTool.name),
                this.ctx.chatluna.platform.registerTool(langChainTool.name, {
                    description: mcpTool.description,
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
                        serverName,
                        defaultAvailability: {
                            enabled: true,
                            main: true,
                            chatluna: true,
                            characterScope: 'all'
                        }
                    }
                })
            )

            registered.push(mcpTool.name)
        }

        if (this.plugin.config.mcpToolMode === 'catalog') {
            this._registerGateways()
        }

        if (registered.length > 0) {
            logger.debug(
                `MCP tools registered for ${serverName}: ${registered.join(', ')}`
            )
        }
        if (disabled.length > 0) {
            logger.debug(
                `MCP tools disabled for ${serverName}: ${disabled.join(', ')}`
            )
        }

        for (const [toolName, toolCfg] of Object.entries(this._tools)) {
            if (toolCfg.server === serverName && !names.has(toolName)) {
                delete this._tools[toolName]
            }
        }

        this.ctx.chatluna_agent?.permission.invalidateCache()
        return mcpTools.tools.length
    }

    private _registerGateways() {
        if (
            this.plugin.config.mcpToolMode !== 'catalog' ||
            this._gatewayDisposers.length > 0 ||
            Object.keys(this.config.mcp.mcpServers).length === 0
        ) {
            return
        }

        const search = tool(
            async (input: McpSearchInput, config?: RunnableConfig) => {
                const mask = getRequiredToolCallMask(config)

                // 首次搜索时：触发后台索引
                if (this._definitions.size === 0 && !this._indexing) {
                    logger.info(
                        'First search detected, indexing all MCP servers in background...'
                    )
                    this._ensureIndexing()
                }

                // 等待索引完成（如果正在进行）
                if (this._indexingPromise) {
                    await this._indexingPromise
                }

                if (input.action === 'schema') {
                    if (!input.server || !input.tool) {
                        throw new ToolException(
                            'MCP schema lookup requires an exact server and tool'
                        )
                    }

                    const t = this._definitions.get(
                        toolId(input.server, input.tool)
                    )
                    if (
                        !this.config.mcp.mcpServers[input.server] ||
                        !t?.enabled ||
                        !applyToolMask(input.tool, mask)
                    ) {
                        throw new ToolException(
                            `MCP tool schema is unavailable: ${input.server}/${input.tool}`
                        )
                    }

                    return structuredGatewayResponse({
                        action: 'schema',
                        result: createMcpCatalogSchemaResult(
                            input.server,
                            t.catalog
                        )
                    })
                }

                const query = input.query.trim()
                if (!query) {
                    throw new ToolException(
                        'MCP catalog search requires a non-empty query'
                    )
                }

                const results = Array.from(this._definitions.values())
                    .filter(
                        (t) =>
                            t.enabled &&
                            this.config.mcp.mcpServers[t.server] &&
                            applyToolMask(t.name, mask)
                    )
                    .map((t) => ({
                        server: t.server,
                        item: t.catalog,
                        score: scoreMcpCatalogTool(query, t.server, t.catalog)
                    }))
                    .filter((item) => item.score > 0)
                    .sort(
                        (left, right) =>
                            right.score - left.score ||
                            `${left.server}/${left.item.name}`.localeCompare(
                                `${right.server}/${right.item.name}`
                            )
                    )
                    .slice(0, input.limit)
                    .map(({ server, item }) =>
                        createMcpCatalogSummaryResult(server, item)
                    )

                return structuredGatewayResponse({
                    action: 'search',
                    query,
                    results
                })
            },
            {
                name: 'search_mcp_tools',
                description:
                    'Discover MCP tools in two stages. First use action="search" ' +
                    'to get compact candidates without schemas. Then use ' +
                    'action="schema" with one exact server and tool to load its ' +
                    'inputSchema. Always load the schema before invoke_mcp_tool.',
                responseFormat: 'content_and_artifact',
                schema: mcpSearchSchema
            }
        )
        const invoke = tool(
            async (input: McpInvokeInput, config?: RunnableConfig) =>
                await this._callMcpTool(
                    input.server,
                    input.tool,
                    input.arguments,
                    config
                ),
            {
                name: 'invoke_mcp_tool',
                description:
                    'Invoke one MCP tool after loading its exact inputSchema with ' +
                    'search_mcp_tools action="schema". Copy the exact server and ' +
                    'tool name and construct arguments from that schema. ' +
                    'Validation errors are returned as structured JSON.',
                responseFormat: 'content_and_artifact',
                schema: mcpInvokeSchema
            }
        )

        for (const gateway of [search, invoke]) {
            this._gatewayDisposers.push(
                this.ctx.chatluna.platform.registerTool(gateway.name, {
                    description: gateway.description,
                    createTool: () => gateway,
                    selector: () => true,
                    meta: {
                        source: 'mcp',
                        group: 'mcp',
                        tags: ['mcp', 'gateway'],
                        defaultAvailability: {
                            enabled: true,
                            main: true,
                            chatluna: true,
                            characterScope: 'all'
                        }
                    }
                })
            )
        }
    }

    private async _callMcpTool(
        serverName: string,
        toolName: string,
        args: Record<string, unknown>,
        config?: RunnableConfig
    ) {
        const mask = getRequiredToolCallMask(config)
        if (!applyToolMask(toolName, mask)) {
            throw new ToolException(
                `MCP tool is not allowed: ${serverName}/${toolName}`
            )
        }

        const prepared = await this._enqueueServerOperation(
            serverName,
            async () => {
                const cfg = this.config.mcp.mcpServers[serverName]
                if (!cfg) {
                    throw new ToolException(
                        `MCP server not found: ${serverName}`
                    )
                }

                let srv = this._servers.get(serverName)
                let t = this._definitions.get(toolId(serverName, toolName))
                if (!t?.enabled) {
                    throw new ToolException(
                        `MCP tool is unavailable: ${serverName}/${toolName}`
                    )
                }

                if (!srv?.client || srv.state !== 'connected') {
                    await this._reconnectNow(serverName)
                    srv = this._servers.get(serverName)
                    t = this._definitions.get(toolId(serverName, toolName))
                }

                if (!srv?.client || srv.state !== 'connected') {
                    throw new ToolException(
                        `MCP server is unavailable: ${serverName}`
                    )
                }
                if (!t?.enabled) {
                    throw new ToolException(
                        `MCP tool is unavailable: ${serverName}/${toolName}`
                    )
                }

                const validation = validateMcpArguments(
                    this._validator,
                    t.catalog.inputSchema,
                    args
                )
                if (validation.valid === false) {
                    return {
                        response: structuredGatewayResponse({
                            ok: false,
                            error: validation.error,
                            server: serverName,
                            tool: toolName,
                            message: validation.message,
                            inputSchema: t.catalog.inputSchema
                        })
                    }
                }

                this._beginActiveCall(serverName)
                return {
                    client: srv.client,
                    timeout: t.timeout,
                    data: validation.data
                }
            }
        )

        if ('response' in prepared) {
            return prepared.response
        }

        try {
            return await callTool(
                serverName,
                toolName,
                prepared.client,
                prepared.data,
                { ...config, timeout: prepared.timeout },
                undefined,
                this.ctx,
                logger
            )
        } finally {
            this._endActiveCall(serverName)
        }
    }

    private _enqueueServerOperation<T>(
        name: string,
        operation: () => Promise<T>
    ): Promise<T> {
        const previous = this._serverOperations.get(name) ?? Promise.resolve()
        const task = previous.then(operation)
        const tail = task.then(
            () => undefined,
            () => undefined
        )
        this._serverOperations.set(name, tail)
        tail.then(() => {
            if (this._serverOperations.get(name) === tail) {
                this._serverOperations.delete(name)
            }
        })
        return task
    }

    private _beginActiveCall(name: string) {
        this._activeCalls.set(name, (this._activeCalls.get(name) ?? 0) + 1)
    }

    private _endActiveCall(name: string) {
        const remaining = Math.max(0, (this._activeCalls.get(name) ?? 1) - 1)
        if (remaining > 0) {
            this._activeCalls.set(name, remaining)
            return
        }

        this._activeCalls.delete(name)
        const waiters = this._activeCallWaiters.get(name)
        this._activeCallWaiters.delete(name)
        for (const resolve of waiters ?? []) resolve()
    }

    private async _waitForActiveCalls(name: string) {
        if ((this._activeCalls.get(name) ?? 0) === 0) return

        await new Promise<void>((resolve) => {
            const waiters = this._activeCallWaiters.get(name) ?? new Set()
            waiters.add(resolve)
            this._activeCallWaiters.set(name, waiters)
        })
    }

    private _runInBackground(tasks: Promise<unknown>[], reason: string) {
        Promise.allSettled(tasks).then(() => {
            if (this._stopped) return
            logger.info(
                `${reason} finished with ${this._disposers.size} tool(s)`
            )
            this.ctx.chatluna_agent?.refreshConsoleData()
        })
    }

    private _isCurrent(name: string, client: Client) {
        const srv = this._servers.get(name)
        return !this._stopped && srv?.client === client
    }

    private async _drop(name: string, clearTools = true) {
        await this._waitForActiveCalls(name)
        const srv = this._servers.get(name)
        if (srv) {
            srv.reconnectDispose?.()
            srv.reconnectDispose = undefined
            srv.connectTask = undefined
            const client = srv.client
            srv.client = undefined
            if (client) {
                client.onclose = undefined
                client.onerror = undefined
                await client.close().catch(() => {})
            }
        }

        if (clearTools || this.plugin.config.mcpToolMode !== 'catalog') {
            this._disposeTools(name)
        }

        if (clearTools) {
            for (const [toolName, t] of Object.entries(this._tools)) {
                if (t.server === name) {
                    delete this._tools[toolName]
                }
            }
            for (const [id, t] of this._definitions) {
                if (t.server === name) {
                    this._definitions.delete(id)
                }
            }
        }

        this.ctx.chatluna_agent?.permission.invalidateCache()
    }

    private async _remove(name: string) {
        return await this._enqueueServerOperation(name, () =>
            this._removeNow(name)
        )
    }

    private async _removeNow(name: string) {
        await this._drop(name)
        this._servers.delete(name)
        if (Object.keys(this.config.mcp.mcpServers).length === 0) {
            this._disposeGateways()
        } else {
            this._registerGateways()
        }
        this.ctx.chatluna_agent?.refreshConsoleData()
    }

    private _disposeGateways() {
        for (const dispose of this._gatewayDisposers) {
            dispose()
        }
        this._gatewayDisposers = []
    }

    private _disposeTools(name: string) {
        const prefix = `${name}/`
        for (const id of Array.from(this._disposers.keys())) {
            if (!id.startsWith(prefix)) continue
            this._disposeTool(name, id.slice(prefix.length))
        }
    }

    private _disposeTool(server: string, name: string) {
        const id = toolId(server, name)
        const dispose = this._disposers.get(id)
        if (!dispose) return

        const current = this.ctx.chatluna.platform.getToolRegistry()[name]
        if (!current || current.meta?.serverName === server) {
            dispose()
        }
        this._disposers.delete(id)
    }

    private _ensureIndexing() {
        if (this._indexing || this._indexingPromise) {
            return this._indexingPromise
        }

        this._indexing = true
        this._indexingPromise = this._indexAllServers()
        this._indexingPromise.finally(() => {
            this._indexing = false
        })
        return this._indexingPromise
    }

    private async _indexAllServers() {
        if (this._stopped) return

        logger.info('Starting MCP server indexing...')
        const startTime = Date.now()

        const tasks = Object.entries(this.config.mcp.mcpServers).map(
            ([name, cfg]) =>
                this._enqueueServerOperation(name, async () => {
                    if (this._stopped) return
                    try {
                        const success = await this._connect(name, cfg)
                        if (success) {
                            logger.debug(`Indexed MCP server: ${name}`)
                        }
                    } catch (error) {
                        logger.warn(
                            `Failed to index MCP server ${name}:`,
                            error
                        )
                    }
                })
        )

        await Promise.allSettled(tasks)

        const elapsed = Date.now() - startTime
        const toolCount = this._definitions.size
        logger.info(
            `MCP indexing complete: ${toolCount} tool(s) from ${this._servers.size} server(s) in ${elapsed}ms`
        )
        this.ctx.chatluna_agent?.refreshConsoleData()
    }
}

const mcpSearchSchema = z.object({
    action: z
        .enum(['search', 'schema'])
        .describe('Use search for discovery, then schema for one exact tool.'),
    query: z
        .string()
        .default('')
        .describe('Capability query. Required when action is search.'),
    limit: z.number().int().min(1).max(20).default(8),
    server: z
        .string()
        .default('')
        .describe('Exact server. Required when action is schema.'),
    tool: z
        .string()
        .default('')
        .describe('Exact tool name. Required when action is schema.')
})

const mcpInvokeSchema = z.object({
    server: z.string().describe('Exact server name returned by search.'),
    tool: z.string().describe('Exact tool name returned by search.'),
    arguments: z
        .record(z.unknown())
        .describe('Arguments matching the separately loaded inputSchema.')
})

type McpSearchInput = z.infer<typeof mcpSearchSchema>
type McpInvokeInput = z.infer<typeof mcpInvokeSchema>

type ToolInfo = {
    name: string
    server: string
    enabled: boolean
    description: string
    timeout: number
    selector: string[]
    title?: string
    icon?: McpIcon
    catalog: McpCatalogTool
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

function getRequiredToolCallMask(config?: RunnableConfig) {
    const mask = (config?.configurable?.['toolMask'] ??
        config?.configurable?.['agentContext']?.['toolMask'] ??
        config?.configurable?.['subagentContext']?.['toolMask']) as
        ToolMask | undefined
    const callMask = mask?.toolCallMask ?? mask
    if (!callMask) {
        logger.warn(
            'MCP tool permission context is unavailable, falling back to allow-all mode. ' +
                'This may indicate the permission service is not initialized.'
        )
        return { mode: 'all' as const, tools: [], allow: [], deny: [] }
    }
    return callMask
}

function structuredGatewayResponse(payload: Record<string, unknown>) {
    return [JSON.stringify(payload, null, 2), []] as [string, []]
}

function toolId(server: string, name: string) {
    return `${server}/${name}`
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

function calcStartupTimeout(server: McpServerConfig) {
    return Math.max(1, server.startupTimeout ?? 20) * 1000
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
