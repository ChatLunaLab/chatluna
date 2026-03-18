/** @module service/computer */

import { SystemMessage } from '@langchain/core/messages'
import type { ChatLunaToolRunnable } from 'koishi-plugin-chatluna/llm-core/platform/types'
import {
    countMessageTokens,
    PromptContextRuntime
} from 'koishi-plugin-chatluna/llm-core/prompt'
import { Context } from 'koishi'
import {
    AgentConfig,
    ComputerBackendStatus,
    ComputerBackendType,
    ComputerCapability,
    ComputerDesktopState,
    ComputerStatus,
    ComputerTerminalInfo
} from '../types'
import {
    buildComputerSessionKey,
    ComputerSessionStore
} from '../computer/session'
import { LocalComputerSession } from '../computer/backends/local'
import { OpenTerminalComputerSession } from '../computer/backends/open_terminal'
import { E2BComputerSession } from '../computer/backends/e2b'
import {
    ComputerSessionApi,
    DesktopAction,
    TerminalHandle
} from '../computer/types'
import { SkillMaterializer } from '../computer/materialize'
import { ChatLunaAgentComputerProxy } from '../computer/proxy'
import { ReadFileTool } from '../computer/tools/file_read'
import { WriteFileTool } from '../computer/tools/file_write'
import { EditFileTool } from '../computer/tools/file_edit'
import { GrepTool } from '../computer/tools/grep'
import { GlobTool } from '../computer/tools/glob'
import { BashTool } from '../computer/tools/bash'

export class ChatLunaAgentComputerService {
    private _sessions = new ComputerSessionStore()
    private _status: ComputerStatus
    private _toolDispose: (() => void)[] = []
    private _promptDispose?: () => void
    private _idleDispose?: () => void
    private _proxy: ChatLunaAgentComputerProxy
    private _terminals = new Map<string, Map<string, TerminalHandle>>()

    readonly materializer = new SkillMaterializer()

    constructor(
        public ctx: Context,
        public config: AgentConfig
    ) {
        this._status = this.buildStatus()
        this._proxy = new ChatLunaAgentComputerProxy(ctx, this)
    }

    async start() {
        this._proxy.start()
        await this.reload()
    }

    async stop() {
        this._idleDispose?.()
        this._idleDispose = undefined
        for (const dispose of this._toolDispose) {
            dispose()
        }
        this._toolDispose = []
        this._promptDispose?.()
        this._promptDispose = undefined
        await this.closeAllTerminals()
        await this._sessions.clear()
        this._status = this.buildStatus()
        this._proxy.stop()
    }

    async reload() {
        await this.closeAllTerminals()
        await this._sessions.clear()
        this._status = this.buildStatus()
        this.syncIdleCleanup()
        this.syncTools()
        this.syncPrompt()
    }

    getStatus() {
        return this._status
    }

    getSession(sessionId: string) {
        return this._sessions.getBySessionId(sessionId)
    }

    getSessionInfo(sessionId: string) {
        return this._sessions.getInfoBySessionId(sessionId)
    }

    getTerminal(sessionId: string, terminalId: string) {
        return this._terminals.get(sessionId)?.get(terminalId)
    }

    touchSession(sessionId: string) {
        this._sessions.touchBySessionId(sessionId)
    }

    async closeTerminal(sessionId: string, terminalId: string) {
        const session = this._terminals.get(sessionId)
        const terminal = session?.get(terminalId)
        if (!terminal) {
            return
        }

        await terminal.kill()
        session?.delete(terminalId)
        if (session && session.size < 1) {
            this._terminals.delete(sessionId)
        }
    }

    async getOrCreateSession(options: {
        backend?: ComputerBackendType
        allowedBackends?: ComputerBackendType[]
        conversationId?: string
        userId?: string
    }) {
        const backend = this.resolveProvider(
            options.backend,
            options.allowedBackends
        )
        if (!backend) {
            throw new Error('No supported computer backend is available.')
        }

        const key = buildComputerSessionKey({
            backend,
            conversationId: options.conversationId,
            userId: options.userId
        })

        const session = await this._sessions.getOrCreate(
            key,
            {
                backend,
                conversationId: options.conversationId,
                userId: options.userId
            },
            async () => {
                const item = this.createTrackedSession(
                    await this.createSession(backend, options.userId)
                )
                await item.connect()
                return item
            }
        )

        this.refreshStatus()
        return session
    }

    async destroySession(id: string) {
        await this.closeAllTerminals(id)
        await this._sessions.destroyBySessionId(id)
        this.refreshStatus()
    }

    async testBackend(type: ComputerBackendType) {
        const session = await this.createSession(type)
        try {
            await session.connect()
            await session.disconnect()
            return {
                ...this.buildStatus().backends[type],
                state: 'connected',
                error: undefined
            } satisfies ComputerBackendStatus
        } catch (err) {
            return {
                ...this.buildStatus().backends[type],
                state: 'error',
                error: err instanceof Error ? err.message : String(err)
            } satisfies ComputerBackendStatus
        }
    }

    getCapabilities(type?: ComputerBackendType) {
        if (type) {
            const status = this._status.backends[type]
            return !isAvailableBackend(status) ? [] : [...status.capabilities]
        }

        return Array.from(
            new Set(
                this.listAvailableBackends().flatMap(
                    (item) => this._status.backends[item].capabilities
                )
            )
        )
    }

    listAvailableBackends(): ComputerBackendType[] {
        return Object.values(this._status.backends)
            .filter((item) => isAvailableBackend(item))
            .map((item) => item.type)
    }

    async createTerminal(
        clientId: string,
        input: {
            backend?: ComputerBackendType
            cwd?: string
            cols?: number
            rows?: number
        } = {}
    ): Promise<ComputerTerminalInfo> {
        const session = await this.getOrCreateUiSession(clientId, input.backend)
        if (!session.createTerminal) {
            throw new Error(
                `Backend ${session.backend} does not support terminals.`
            )
        }

        const raw = await session.createTerminal({
            cwd: input.cwd,
            cols: input.cols,
            rows: input.rows
        })
        const terminal: TerminalHandle = {
            id: raw.id,
            onData: async (callback) => {
                await raw.onData((data) => {
                    this.touchSession(session.sessionId)
                    callback(data)
                })
            },
            sendInput: async (data) => {
                this.touchSession(session.sessionId)
                await raw.sendInput(data)
            },
            resize: async (cols, rows) => {
                this.touchSession(session.sessionId)
                await raw.resize(cols, rows)
            },
            kill: async () => {
                this.touchSession(session.sessionId)
                await raw.kill()
            }
        }
        const list =
            this._terminals.get(session.sessionId) ??
            new Map<string, TerminalHandle>()
        list.set(terminal.id, terminal)
        this._terminals.set(session.sessionId, list)

        return {
            sessionId: session.sessionId,
            terminalId: terminal.id,
            backend: session.backend,
            url: `/chatluna/computer/terminal/${session.sessionId}/${terminal.id}`
        }
    }

    async readFileForUi(
        clientId: string,
        input: {
            path: string
            backend?: ComputerBackendType
            offset?: number
            limit?: number
        }
    ) {
        const session = await this.getOrCreateUiSession(clientId, input.backend)
        return await session.readFile(input.path, input.offset, input.limit)
    }

    async readFileAssetForUi(
        clientId: string,
        input: {
            path: string
            backend?: ComputerBackendType
        }
    ) {
        const session = await this.getOrCreateUiSession(clientId, input.backend)
        if (!session.readAsset) {
            throw new Error('Binary file preview is not available.')
        }

        return await session.readAsset(input.path)
    }

    async globForUi(
        clientId: string,
        input: { pattern: string; path?: string; backend?: ComputerBackendType }
    ) {
        const session = await this.getOrCreateUiSession(clientId, input.backend)
        return await session.glob(input.pattern, input.path)
    }

    async readMaterializedSkillFile(
        session: ComputerSessionApi,
        filePath: string,
        offset?: number,
        limit?: number
    ) {
        const normalized = filePath.replaceAll('\\', '/')
        const marker = '.chatluna/skills/'
        const index = normalized.indexOf(marker)
        if (index === -1) {
            throw new Error('Not a materialized skill path.')
        }

        const rest = normalized.slice(index + marker.length)
        const [name, ...parts] = rest.split('/').filter(Boolean)
        if (!name) {
            throw new Error('Invalid materialized skill path.')
        }

        const skill =
            this.ctx.chatluna_agent?.skills.getVisibleSkillByName(name)
        if (!skill) {
            throw new Error(`Skill not found: ${name}`)
        }

        const root = await this.materializer.materialize(skill, session)
        const target =
            parts.length > 0 ? `${root}/${parts.join('/')}` : `${root}/SKILL.md`
        return await session.readFile(target, offset, limit)
    }

    async getDesktopState(
        clientId: string,
        backend?: ComputerBackendType
    ): Promise<ComputerDesktopState> {
        const session = await this.getOrCreateUiSession(clientId, backend)
        const info = await session.getDesktopInfo?.()
        const screenshot = session.screenshot
            ? await session.screenshot().catch(() => undefined)
            : undefined
        return {
            sessionId: session.sessionId,
            backend: session.backend,
            info: info
                ? {
                      width: info.width,
                      height: info.height,
                      streamUrl: info.streamUrl
                  }
                : undefined,
            screenshot: screenshot
                ? {
                      data: screenshot.data,
                      mimeType: screenshot.mimeType,
                      width: screenshot.width,
                      height: screenshot.height
                  }
                : undefined
        }
    }

    async sendDesktopAction(sessionId: string, action: DesktopAction) {
        const session = this.getSession(sessionId)
        if (!session?.desktopAction) {
            throw new Error(
                'Desktop control is not available for this session.'
            )
        }

        await session.desktopAction(action)
    }

    resolveSecret(value: string) {
        if (!value.startsWith('env:')) {
            return value
        }

        return process.env[value.slice(4)] ?? ''
    }

    async getToolSession(
        runConfig?: ChatLunaToolRunnable,
        backend?: ComputerBackendType
    ) {
        return await this.getOrCreateSession(
            this.resolveSessionInput(runConfig, backend)
        )
    }

    private async getOrCreateUiSession(
        clientId: string,
        backend?: ComputerBackendType
    ) {
        return await this.getOrCreateSession({
            backend,
            conversationId: `console:${clientId}`,
            userId: clientId
        })
    }

    private resolveSessionInput(
        runConfig?: ChatLunaToolRunnable,
        backend?: ComputerBackendType
    ) {
        const session = runConfig?.configurable?.session
        const sub = runConfig?.configurable?.subagentContext
        const info = sub
            ? this.ctx.chatluna_agent?.subAgent
                  .getCatalogSync()
                  .find((item) => item.id === sub.agentId)
            : undefined
        return {
            backend,
            allowedBackends: info
                ? this.ctx.chatluna_agent?.permission.filterComputerBackends(
                      info,
                      COMPUTER_BACKENDS
                  )
                : undefined,
            conversationId:
                sub?.parentConversationId ??
                runConfig?.configurable?.conversationId,
            userId: runConfig?.configurable?.userId ?? session?.userId
        }
    }

    private createTrackedSession(
        session: ComputerSessionApi
    ): ComputerSessionApi {
        return new Proxy(session, {
            get: (target, prop, receiver) => {
                const value = Reflect.get(target, prop, receiver)
                if (typeof value !== 'function') {
                    return value
                }

                return (...args: unknown[]) => {
                    this._sessions.enterBySessionId(target.sessionId)
                    try {
                        const result = value.apply(target, args)
                        if (
                            result &&
                            typeof result === 'object' &&
                            typeof (result as Promise<unknown>).finally ===
                                'function'
                        ) {
                            return (result as Promise<unknown>).finally(() => {
                                this._sessions.leaveBySessionId(
                                    target.sessionId
                                )
                            })
                        }

                        this._sessions.leaveBySessionId(target.sessionId)
                        return result
                    } catch (err) {
                        this._sessions.leaveBySessionId(target.sessionId)
                        throw err
                    }
                }
            }
        })
    }

    private syncIdleCleanup() {
        this._idleDispose?.()
        const timeout = this.config.computer.idleTimeoutMs
        this._idleDispose = this.ctx.setInterval(
            async () => {
                const items = this._sessions.list().filter((item) => {
                    if (this._sessions.isBusy(item.id)) {
                        return false
                    }

                    return Date.now() - item.lastActiveAt >= timeout
                })

                for (const item of items) {
                    const info = this.getSessionInfo(item.id)
                    if (!info || this._sessions.isBusy(item.id)) {
                        continue
                    }
                    if (Date.now() - info.lastActiveAt < timeout) {
                        continue
                    }

                    await this.destroySession(item.id)
                    this.ctx.logger.debug(
                        `Closed idle computer session ${item.id} after ${timeout}ms`
                    )
                }
            },
            Math.max(1000, Math.min(timeout, 60 * 1000))
        )
    }

    private async createSession(backend: ComputerBackendType, userId?: string) {
        const cwd =
            this.config.computer.local.scopePath &&
            !/^[A-Za-z]:/.test(this.config.computer.local.scopePath)
                ? this.config.computer.local.scopePath.replaceAll('\\', '/')
                : '/workspace'

        if (backend === 'local') {
            return new LocalComputerSession(this.config.computer.local)
        }

        if (backend === 'open-terminal') {
            return new OpenTerminalComputerSession(
                this.ctx,
                {
                    ...this.config.computer.openTerminal,
                    apiKey: this.resolveSecret(
                        this.config.computer.openTerminal.apiKey
                    )
                },
                { userId, cwd }
            )
        }

        return new E2BComputerSession(
            {
                ...this.config.computer.e2b,
                apiKey: this.resolveSecret(this.config.computer.e2b.apiKey)
            },
            { cwd }
        )
    }

    private resolveProvider(
        preferred?: ComputerBackendType,
        allowedBackends?: ComputerBackendType[]
    ) {
        const order: (ComputerBackendType | undefined)[] = [
            preferred ?? this.config.computer.defaultProvider,
            'local',
            'open-terminal',
            'e2b'
        ]
        const backends = allowedBackends ?? COMPUTER_BACKENDS
        for (const item of order) {
            if (!item) {
                continue
            }

            if (!backends.includes(item)) {
                continue
            }

            const status = this._status.backends[item]
            if (isAvailableBackend(status)) {
                return item
            }
        }
    }

    private syncTools() {
        for (const dispose of this._toolDispose) {
            dispose()
        }
        this._toolDispose = []
        this.ctx.chatluna_agent?.permission.invalidateCache()

        if (!this._status.enabled) {
            return
        }

        for (const item of COMPUTER_TOOLS) {
            const tool = item.factory(this)
            this._toolDispose.push(
                this.ctx.chatluna.platform.registerTool(item.name, {
                    description: tool.description,
                    selector: () => this._status.enabled,
                    createTool: () => item.factory(this),
                    meta: {
                        source: 'extension',
                        group: 'computer',
                        tags: ['computer']
                    }
                })
            )
        }

        this.ctx.chatluna_agent?.permission.invalidateCache()
    }

    private syncPrompt() {
        this._promptDispose?.()
        this._promptDispose = undefined

        if (!this._status.enabled) {
            return
        }

        this._promptDispose = this.ctx.chatluna.contextManager.pipeline(
            'after_system_prompts',
            async (runtime: PromptContextRuntime, next) => {
                const msg = new SystemMessage(
                    [
                        '<computer_use>',
                        `Default provider: ${this.resolveProvider() ?? this.config.computer.defaultProvider}`,
                        `Available capabilities: ${this.getCapabilities().join(', ')}`,
                        'Use these capabilities when file operations, code search, shell execution, terminal interaction, or preview access are needed.',
                        '</computer_use>'
                    ].join('\n')
                )
                runtime.result.push(msg)
                runtime.usedTokens += await countMessageTokens(
                    msg,
                    runtime.tokenCounter
                )
                return next()
            },
            5
        )
    }

    private refreshStatus() {
        const status = this.buildStatus()
        const sessions = this._sessions.list()
        const counts: Record<ComputerBackendType, number> = {
            local: 0,
            e2b: 0,
            'open-terminal': 0
        }

        for (const item of sessions) {
            counts[item.backend] += 1
        }

        status.activeSessions = sessions.length
        status.backends.local.sessionCount = counts.local
        status.backends.e2b.sessionCount = counts.e2b
        status.backends['open-terminal'].sessionCount = counts['open-terminal']

        this._status = status
    }

    private buildStatus(): ComputerStatus {
        const local = buildBackendStatus(
            'local',
            this.config.computer.local.enabled,
            [...BASE_CAPABILITIES],
            undefined
        )

        const openTerminal = buildBackendStatus(
            'open-terminal',
            this.config.computer.openTerminal.enabled,
            [...BASE_CAPABILITIES],
            this.config.computer.openTerminal.enabled &&
                !this.config.computer.openTerminal.baseUrl
                ? 'open-terminal baseUrl is empty.'
                : undefined
        )

        const e2b = buildBackendStatus(
            'e2b',
            this.config.computer.e2b.enabled,
            this.config.computer.e2b.desktopTemplate
                ? [...BASE_CAPABILITIES, ...E2B_EXTRA]
                : [...BASE_CAPABILITIES],
            this.config.computer.e2b.enabled &&
                !this.resolveSecret(this.config.computer.e2b.apiKey)
                ? 'E2B apiKey is empty.'
                : undefined
        )

        return {
            enabled:
                isAvailableBackend(local) ||
                isAvailableBackend(openTerminal) ||
                isAvailableBackend(e2b),
            defaultProvider: this.config.computer.defaultProvider,
            backends: {
                local,
                e2b,
                'open-terminal': openTerminal
            },
            activeSessions: 0
        }
    }

    private async closeAllTerminals(sessionId?: string) {
        const entries: [string, Map<string, TerminalHandle> | undefined][] =
            sessionId
                ? [[sessionId, this._terminals.get(sessionId)]]
                : Array.from(this._terminals.entries())
        for (const [id, items] of entries) {
            if (!items) {
                continue
            }
            for (const terminal of items.values()) {
                await terminal.kill()
            }
            this._terminals.delete(id)
        }
    }
}

function buildBackendStatus(
    type: ComputerBackendType,
    enabled: boolean,
    capabilities: ComputerCapability[],
    error?: string
): ComputerBackendStatus {
    return {
        type,
        state: !enabled ? 'unsupported' : error ? 'error' : 'idle',
        error,
        capabilities,
        sessionCount: 0
    }
}

function isAvailableBackend(status: ComputerBackendStatus) {
    return (
        status.state === 'idle' ||
        status.state === 'connecting' ||
        status.state === 'connected'
    )
}

const BASE_CAPABILITIES: ComputerCapability[] = [
    'file_read',
    'file_write',
    'file_edit',
    'grep',
    'glob',
    'bash',
    'terminal_pty'
]

const E2B_EXTRA: ComputerCapability[] = [
    'desktop_stream',
    'desktop_screenshot',
    'desktop_action'
]

const COMPUTER_BACKENDS: ComputerBackendType[] = [
    'local',
    'e2b',
    'open-terminal'
]

const COMPUTER_TOOLS = [
    {
        name: 'file_read',
        factory: (svc: ChatLunaAgentComputerService) => new ReadFileTool(svc)
    },
    {
        name: 'file_write',
        factory: (svc: ChatLunaAgentComputerService) => new WriteFileTool(svc)
    },
    {
        name: 'file_edit',
        factory: (svc: ChatLunaAgentComputerService) => new EditFileTool(svc)
    },
    {
        name: 'grep',
        factory: (svc: ChatLunaAgentComputerService) => new GrepTool(svc)
    },
    {
        name: 'glob',
        factory: (svc: ChatLunaAgentComputerService) => new GlobTool(svc)
    },
    {
        name: 'bash',
        factory: (svc: ChatLunaAgentComputerService) => new BashTool(svc)
    }
]
