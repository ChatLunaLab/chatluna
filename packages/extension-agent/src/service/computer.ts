/** @module service/computer */

import { randomUUID } from 'node:crypto'
import os from 'node:os'
import path from 'node:path'
import { SystemMessage } from '@langchain/core/messages'
import which from 'which'
import type {
    AgentRunContext,
    ToolMask
} from 'koishi-plugin-chatluna/llm-core/agent'
import type { ChatLunaToolRunnable } from 'koishi-plugin-chatluna/llm-core/platform/types'
import {
    countMessageTokens,
    PromptContextRuntime
} from 'koishi-plugin-chatluna/llm-core/prompt'
import { Context } from 'koishi'
import type {} from 'koishi-plugin-chatluna-storage-service'
import { logger } from '..'
import {
    AgentConfig,
    ComputerBackendStatus,
    ComputerBackendType,
    ComputerBackgroundJobState,
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
import { findGitBash, findPowerShell } from '../computer/backends/local/shell'
import { OpenTerminalComputerSession } from '../computer/backends/open_terminal'
import { E2BComputerSession } from '../computer/backends/e2b'
import {
    ComputerSessionApi,
    DesktopAction,
    TerminalHandle
} from '../computer/types'
import { SkillMaterializer } from '../computer/materialize'
import { ChatLunaAgentComputerProxy } from '../computer/proxy'
import {
    appendBackgroundOutput,
    BackgroundJob,
    ManagedTerminal,
    readBackgroundExit,
    stripBackgroundMarker,
    toBackgroundJobInfo
} from '../computer/background'
import { ReadFileTool } from '../computer/tools/file_read'
import { WriteFileTool } from '../computer/tools/file_write'
import { EditFileTool } from '../computer/tools/file_edit'
import { PublishFileTool } from '../computer/tools/publish_file'
import { GrepTool } from '../computer/tools/grep'
import { GlobTool } from '../computer/tools/glob'
import { BashTool } from '../computer/tools/bash'
import { quoteShell, quoteShellPath } from '../utils/shell'

export class ChatLunaAgentComputerService {
    private _sessions = new ComputerSessionStore()
    private _status: ComputerStatus
    private _toolDispose: (() => void)[] = []
    private _promptDispose?: () => void
    private _idleDispose?: () => void
    private _proxy: ChatLunaAgentComputerProxy
    private _terminals = new Map<string, Map<string, ManagedTerminal>>()
    private _jobs = new Map<string, BackgroundJob>()
    private _tasks = new Set<Promise<void>>()

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
        await Promise.allSettled(this._tasks)
        await this.closeAllTerminals()
        this._jobs.clear()
        await this._sessions.clear()
        this._status = this.buildStatus()
        this._proxy.stop()
    }

    async reload() {
        await Promise.allSettled(this._tasks)
        await this.closeAllTerminals()
        this._jobs.clear()
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

    getPromptWorkdir(conversationId?: string, backend?: ComputerBackendType) {
        if (!this._status.enabled) {
            return undefined
        }

        const type =
            backend ??
            this.resolveProvider() ??
            this.config.computer.defaultProvider
        if (conversationId) {
            const session = this._sessions.get(
                buildComputerSessionKey({ backend: type, conversationId })
            )
            if (session) {
                return session.cwd
            }
        }

        if (type === 'local') {
            return this.config.computer.local.scopePath || process.cwd()
        }

        return '~'
    }

    async getPromptTempDir(
        conversationId?: string,
        backend?: ComputerBackendType
    ) {
        if (!this._status.enabled) {
            return undefined
        }

        const type =
            backend ??
            this.resolveProvider() ??
            this.config.computer.defaultProvider
        if (conversationId) {
            const session = this._sessions.get(
                buildComputerSessionKey({ backend: type, conversationId })
            )
            if (session) {
                return await session.getTempDir()
            }
        }

        if (type === 'local') {
            return os.tmpdir()
        }

        return '/tmp'
    }

    getTerminal(sessionId: string, terminalId: string) {
        return this._terminals.get(sessionId)?.get(terminalId)
    }

    shouldCloseTerminalOnSocketClose(sessionId: string, terminalId: string) {
        const terminal = this._terminals.get(sessionId)?.get(terminalId)
        if (!terminal) {
            return true
        }

        return !terminal.persistent
    }

    touchSession(sessionId: string) {
        this._sessions.touchBySessionId(sessionId)
    }

    async closeTerminal(sessionId: string, terminalId: string) {
        await this.closeManagedTerminal(sessionId, terminalId, 'killed')
    }

    async listBackgroundJobs(backend?: ComputerBackendType) {
        return Array.from(this._jobs.values())
            .filter((job) => (backend ? job.backend === backend : true))
            .sort((a, b) => b.startedAt - a.startedAt)
            .map((job) => toBackgroundJobInfo(job))
    }

    getBackgroundJob(jobId: string) {
        const job = this._jobs.get(jobId)
        return job ? toBackgroundJobInfo(job) : undefined
    }

    async killBackgroundJob(jobId: string) {
        const job = this._jobs.get(jobId)
        if (!job) {
            return undefined
        }

        await this.closeManagedTerminal(job.sessionId, job.terminalId, 'killed')
        return toBackgroundJobInfo(job)
    }

    async removeBackgroundJob(jobId: string) {
        const job = this._jobs.get(jobId)
        if (!job) {
            return undefined
        }

        if (job.state === 'running') {
            await this.closeManagedTerminal(
                job.sessionId,
                job.terminalId,
                'killed'
            )
        }

        this._jobs.delete(jobId)
        return toBackgroundJobInfo(job)
    }

    async runBackgroundCommand(
        command: string,
        options: {
            runConfig?: ChatLunaToolRunnable
            backend?: ComputerBackendType
            workdir?: string
            timeout?: number
        } = {}
    ) {
        const session = await this.getToolSession(
            options.runConfig,
            options.backend
        )
        if (!session.createTerminal) {
            throw new Error(
                `Backend ${session.backend} does not support terminals.`
            )
        }

        const marker = `__CHATLUNA_BACKGROUND_EXIT__${randomUUID().replaceAll('-', '')}`
        const wrapped = session.prepareBackgroundCommand
            ? await session.prepareBackgroundCommand(command, marker, {
                  workdir: options.workdir,
                  session: options.runConfig?.configurable?.session
              })
            : `${command}\n`
        const terminal = await this.createManagedTerminal(
            session,
            {
                cwd: options.workdir,
                cols: 120,
                rows: 30
            },
            true
        )
        const job: BackgroundJob = {
            id: randomUUID(),
            sessionId: session.sessionId,
            terminalId: terminal.info.terminalId,
            backend: session.backend,
            url: terminal.info.url,
            token: terminal.info.token,
            command,
            cwd: options.workdir,
            state: 'running',
            startedAt: Date.now(),
            timeout: options.timeout,
            output: '',
            marker,
            pending: ''
        }

        this._jobs.set(job.id, job)
        job.offData = await terminal.handle.onData((data) => {
            this.appendBackgroundJobOutput(job, data)
        })

        if (options.timeout != null && options.timeout > 0) {
            job.timer = setTimeout(() => {
                this.closeManagedTerminal(
                    job.sessionId,
                    job.terminalId,
                    'timed_out'
                ).catch(() => undefined)
            }, options.timeout)
        }

        try {
            await terminal.handle.sendInput(wrapped)
        } catch (err) {
            this.finishBackgroundJob(job, 'failed', 1)
            await this.closeManagedTerminal(
                job.sessionId,
                job.terminalId
            ).catch(() => undefined)
            throw err
        }

        return toBackgroundJobInfo(job)
    }

    hasRunningJobs(sessionId: string) {
        return Array.from(this._jobs.values()).some(
            (job) => job.sessionId === sessionId && job.state === 'running'
        )
    }

    async handleTerminalSocketClose(sessionId: string, terminalId: string) {
        if (this.shouldCloseTerminalOnSocketClose(sessionId, terminalId)) {
            await this.closeManagedTerminal(sessionId, terminalId)
        }
    }

    private async closeManagedTerminal(
        sessionId: string,
        terminalId: string,
        state?: Extract<ComputerBackgroundJobState, 'killed' | 'timed_out'>
    ) {
        const map = this._terminals.get(sessionId)
        const terminal = map?.get(terminalId)
        if (!terminal) {
            return
        }

        const job = Array.from(this._jobs.values()).find(
            (item) =>
                item.sessionId === sessionId && item.terminalId === terminalId
        )
        if (job && job.state === 'running') {
            this.finishBackgroundJob(job, state ?? 'killed', 1)
        }

        await terminal.terminal.kill()
        map?.delete(terminalId)
        if (map && map.size < 1) {
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
            if (!options.allowedBackends) {
                throw new Error(
                    formatBackendUnavailable(
                        this._status.backends[
                            options.backend ??
                                this.config.computer.defaultProvider
                        ]
                    )
                )
            }

            throw new Error('No supported computer backend is available.')
        }

        const session = await this._sessions.getOrCreate(
            buildComputerSessionKey({
                backend,
                conversationId: options.conversationId,
                userId: options.userId
            }),
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

                const skills = this.ctx.chatluna_agent?.skills
                if (
                    backend !== 'local' &&
                    skills &&
                    (options.conversationId || options.userId)
                ) {
                    const task = (async () => {
                        const list = skills
                            .listSkills()
                            .filter(
                                (info) =>
                                    info.enabled &&
                                    info.state === 'ready' &&
                                    !info.remote
                            )
                        if (list.length < 1) return

                        const started = Date.now()
                        let done = 0
                        const failed: string[] = []
                        logger.info(
                            `Started materializing ${list.length} skill(s) for ${backend} session ${item.sessionId}`
                        )

                        for (let idx = 0; idx < list.length; idx += 25) {
                            await Promise.all(
                                list.slice(idx, idx + 25).map(async (info) => {
                                    const skill = skills.getScannedSkill(
                                        info.id
                                    )
                                    if (!skill) {
                                        done += 1
                                        return
                                    }

                                    await this.materializer
                                        .materialize(skill, item, this.ctx)
                                        .catch((err) => {
                                            failed.push(skill.name)
                                            logger.debug(err)
                                        })
                                    done += 1
                                })
                            )
                        }

                        if (failed.length > 0) {
                            logger.warn(
                                `Failed to materialize ${failed.length} skill(s): ${failed.join(', ')}`
                            )
                        }

                        logger.info(
                            `Finished materializing ${done}/${list.length} skill(s) for ${backend} session ${item.sessionId} in ${Date.now() - started}ms`
                        )
                    })()
                    this._tasks.add(task)
                    task.catch((err) => logger.warn(err)).finally(() =>
                        this._tasks.delete(task)
                    )
                }

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
            return !isAvailableBackend(this._status.backends[type])
                ? []
                : [...this._status.backends[type].capabilities]
        }

        return Array.from(
            new Set(
                this.listAvailableBackends().flatMap(
                    (item) => this._status.backends[item].capabilities
                )
            )
        )
    }

    async hasBin(name: string, backend?: ComputerBackendType) {
        const type = backend ?? this.resolveProvider()
        if (!type || !isAvailableBackend(this._status.backends[type])) {
            return false
        }

        if (type === 'local') {
            if (!this.config.computer.local.dangerouslySkipPermissions) {
                if (
                    this.config.computer.local.blockedCommands.some(
                        (item) => item.toLowerCase() === name.toLowerCase()
                    )
                ) {
                    return false
                }

                if (
                    this.config.computer.local.allowedCommands.length > 0 &&
                    !this.config.computer.local.allowedCommands.some(
                        (item) => item.toLowerCase() === name.toLowerCase()
                    )
                ) {
                    return false
                }
            }

            if (process.platform === 'win32') {
                const lower = name.toLowerCase()
                if (
                    lower === 'bash' ||
                    lower === 'bash.exe' ||
                    lower === 'sh' ||
                    lower === 'sh.exe'
                ) {
                    return (await findGitBash()) != null
                }

                if (
                    lower === 'pwsh' ||
                    lower === 'pwsh.exe' ||
                    lower === 'powershell' ||
                    lower === 'powershell.exe'
                ) {
                    return findPowerShell() != null
                }

                if (lower === 'cmd' || lower === 'cmd.exe') {
                    return true
                }
            }

            return which.sync(name, { nothrow: true }) != null
        }

        const session = await this.getOrCreateSession({ backend: type }).catch(
            () => undefined
        )
        if (!session) {
            return false
        }

        const result = await session
            .execute(
                `sh -lc ${quoteShell(`command -v ${name} >/dev/null 2>&1`)}`,
                { timeout: 5000 }
            )
            .catch(() => undefined)

        return result?.exitCode === 0
    }

    listAvailableBackends(): ComputerBackendType[] {
        return Object.values(this._status.backends)
            .filter((item) => isAvailableBackend(item))
            .map((item) => item.type)
    }

    listSessionInfos() {
        return this._sessions.list()
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
        return (
            await this.createManagedTerminal(
                session,
                {
                    cwd: input.cwd,
                    cols: input.cols,
                    rows: input.rows
                },
                false
            )
        ).info
    }

    private async createManagedTerminal(
        session: ComputerSessionApi,
        options: {
            cwd?: string
            cols?: number
            rows?: number
        },
        persistent: boolean
    ) {
        if (!session.createTerminal) {
            throw new Error(
                `Backend ${session.backend} does not support terminals.`
            )
        }

        const raw = await session.createTerminal(options)
        const terminal: TerminalHandle = {
            id: raw.id,
            onData: async (callback) => {
                return await raw.onData((data) => {
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
        const token = randomUUID()
        const map =
            this._terminals.get(session.sessionId) ??
            new Map<string, ManagedTerminal>()
        map.set(terminal.id, { terminal, persistent, token })
        this._terminals.set(session.sessionId, map)

        return {
            info: {
                sessionId: session.sessionId,
                terminalId: terminal.id,
                backend: session.backend,
                url: `/chatluna/computer/terminal/${session.sessionId}/${terminal.id}`,
                token
            },
            handle: terminal
        }
    }

    private appendBackgroundJobOutput(job: BackgroundJob, data: string) {
        this.touchSession(job.sessionId)
        job.output = appendBackgroundOutput(job.output, data)

        const result = readBackgroundExit(job.pending, data, job.marker)
        job.pending = result.pending
        if (result.exitCode != null) {
            job.output = stripBackgroundMarker(job.output, job.marker)
            this.finishBackgroundJob(
                job,
                result.exitCode === 0 ? 'completed' : 'failed',
                result.exitCode
            )
            this.closeManagedTerminal(job.sessionId, job.terminalId).catch(
                () => undefined
            )
        }
    }

    private finishBackgroundJob(
        job: BackgroundJob,
        state: Exclude<ComputerBackgroundJobState, 'running'>,
        exitCode?: number
    ) {
        if (job.state !== 'running') {
            return
        }

        clearTimeout(job.timer)
        job.timer = undefined
        job.offData?.()
        job.offData = undefined
        job.state = state
        job.exitCode = exitCode
        job.endedAt = Date.now()
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
        const result = await session.glob(input.pattern, input.path)
        if (Array.isArray(result)) return result
        const end = result.outputPath
            ? result.text.lastIndexOf('\n')
            : undefined
        const text =
            end != null && end >= 0
                ? result.text.slice(0, end + 1)
                : result.text
        return text.split('\n').filter(Boolean)
    }

    async getHomeForUi(clientId: string, backend?: ComputerBackendType) {
        const session = await this.getOrCreateUiSession(clientId, backend)
        return session.cwd || session.getScopePath()
    }

    async removeRemoteSkill(dir: string) {
        await this.removeRemoteEntry(dir)
    }

    async removeRemoteSubAgent(path: string) {
        await this.removeRemoteEntry(path)
    }

    async readMaterializedSkillFile(
        session: ComputerSessionApi,
        filePath: string,
        offset?: number,
        limit?: number
    ) {
        const idx = filePath.replaceAll('\\', '/').indexOf('.chatluna/skills/')
        if (idx === -1) {
            throw new Error('Not a materialized skill path.')
        }

        const [name, ...parts] = filePath
            .replaceAll('\\', '/')
            .slice(idx + '.chatluna/skills/'.length)
            .split('/')
            .filter(Boolean)
        if (!name) {
            throw new Error('Invalid materialized skill path.')
        }

        const skill =
            this.ctx.chatluna_agent?.skills.getVisibleSkillByName(name)
        if (!skill) {
            throw new Error(`Skill not found: ${name}`)
        }

        const root = await this.materializer.materialize(
            skill,
            session,
            this.ctx
        )
        return await session.readFile(
            parts.length > 0
                ? `${root}/${parts.join('/')}`
                : `${root}/SKILL.md`,
            offset,
            limit
        )
    }

    async getDesktopState(
        clientId: string,
        backend?: ComputerBackendType
    ): Promise<ComputerDesktopState> {
        const session = await this.getOrCreateUiSession(clientId, backend)
        return {
            sessionId: session.sessionId,
            backend: session.backend,
            info: await session.getDesktopInfo?.(),
            screenshot: session.screenshot
                ? await session.screenshot().catch(() => undefined)
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

    async getAgentSession(
        context: AgentRunContext,
        backend?: ComputerBackendType
    ) {
        return await this.getOrCreateSession(
            this.resolveAgentSessionInput(context, backend)
        )
    }

    async publishFile(
        filePaths: string[],
        runConfig?: ChatLunaToolRunnable
    ): Promise<{ url: string; name: string }[]> {
        if (!this.ctx.chatluna_storage) {
            throw new Error('chatluna-storage-service is not available.')
        }

        const session = await this.getToolSession(runConfig)
        return await Promise.all(
            filePaths.map(async (filePath) => {
                const fileName = path.posix.basename(
                    filePath.replaceAll('\\', '/')
                )
                const asset = await session.openAsset(filePath)
                return await this.ctx.chatluna_storage!.createTempFileFromStream(
                    asset.stream,
                    fileName,
                    {
                        mimeType: asset.mimeType,
                        size: asset.size
                    }
                )
            })
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

    private async getRemoteScanSession() {
        const backend = this.resolveProvider(
            this.config.computer.defaultProvider
        )
        if (!backend || backend === 'local') {
            return undefined
        }

        return await this.getOrCreateSession({
            backend,
            conversationId: `console:remote-scan:${backend}`,
            userId: `console:remote-scan:${backend}`
        })
    }

    private async removeRemoteEntry(entryPath: string) {
        const session = await this.getRemoteScanSession()
        if (!session) {
            throw new Error('Remote computer backend is not available.')
        }

        const target = entryPath.replaceAll('\\', '/')
        if (
            target.length < 2 ||
            target === '/' ||
            target === '~' ||
            /^~?\/?\.?$/.test(target)
        ) {
            throw new Error(`Refusing to remove unsafe path: ${entryPath}`)
        }

        const quoted = quoteShellPath(target)
        const result = await session.execute(
            `if [ -d ${quoted} ]; then rm -rf ${quoted}; elif [ -e ${quoted} ]; then rm -f ${quoted}; fi`,
            { timeout: 15000 }
        )

        if (result.exitCode !== 0) {
            throw new Error(
                result.stderr.trim() ||
                    result.stdout.trim() ||
                    `Failed to remove ${entryPath}`
            )
        }
    }

    private resolveSessionInput(
        runConfig?: ChatLunaToolRunnable,
        backend?: ComputerBackendType
    ) {
        const sub = runConfig?.configurable?.agentContext?.subagentContext
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
                runConfig?.configurable?.agentContext?.conversationId ??
                runConfig?.configurable?.conversationId,
            userId:
                runConfig?.configurable?.userId ??
                runConfig?.configurable?.session?.userId
        }
    }

    private resolveAgentSessionInput(
        context: AgentRunContext,
        backend?: ComputerBackendType
    ) {
        const sub = context.subagentContext
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
            conversationId: sub?.parentConversationId ?? context.conversationId,
            userId: context.userId
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
                for (const item of this._sessions.list()) {
                    if (this._sessions.isBusy(item.id)) {
                        continue
                    }
                    if (this.hasRunningJobs(item.id)) {
                        continue
                    }
                    if (Date.now() - item.lastActiveAt < timeout) {
                        continue
                    }

                    await this.destroySession(item.id)
                    logger.debug(
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
                : undefined

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
            this.ctx,
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
        const list = allowedBackends ?? COMPUTER_BACKENDS
        const target = preferred ?? this.config.computer.defaultProvider
        if (
            list.includes(target) &&
            isAvailableBackend(this._status.backends[target])
        ) {
            return target
        }

        if (preferred || !allowedBackends) {
            return undefined
        }

        for (const item of list) {
            if (item === target) {
                continue
            }

            if (isAvailableBackend(this._status.backends[item])) {
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
            this._toolDispose.push(
                this.ctx.chatluna.platform.registerTool(item.name, {
                    description: item.factory(this).description,
                    selector: () => this._status.enabled,
                    createTool: () => item.factory(this),
                    meta: {
                        source: 'extension',
                        group: 'computer',
                        tags: ['computer'],
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
                const mask = (runtime.configurable as { toolMask?: ToolMask })
                    ?.toolMask
                const registry = this.ctx.chatluna.platform.getToolRegistry()
                const capabilities = (
                    mask != null
                        ? this.ctx.chatluna.platform.getFilteredTools(mask)
                        : Object.keys(registry)
                ).filter((name) =>
                    registry[name]?.meta?.tags?.includes('computer')
                )
                if (capabilities.length < 1) {
                    return next()
                }

                const agentContext = runtime.configurable?.agentContext as {
                    conversationId?: string
                    subagentContext?: { parentConversationId?: string }
                }
                const sub =
                    agentContext?.subagentContext ??
                    runtime.configurable?.subagentContext
                const conversationId =
                    sub?.parentConversationId ??
                    agentContext?.conversationId ??
                    runtime.configurable?.conversationId
                const type =
                    this.resolveProvider() ??
                    this.config.computer.defaultProvider
                const cwd = this.getPromptWorkdir(conversationId, type)
                const tmp = await this.getPromptTempDir(conversationId, type)
                const msg = new SystemMessage(
                    [
                        '<computer_use>',
                        `Default provider: ${type}`,
                        `Available capabilities: ${capabilities.join(', ')}`,
                        `Current working directory: ${cwd}`,
                        `Temporary directory: ${tmp}`,
                        'Prefer isolated backends when available. ' +
                            'Local computer access runs directly on the host machine and should only be used when explicitly enabled.',
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
        const counts = { local: 0, e2b: 0, 'open-terminal': 0 }

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
            BASE_CAPABILITIES
        )

        const openTerminal = buildBackendStatus(
            'open-terminal',
            this.config.computer.openTerminal.enabled,
            BASE_CAPABILITIES,
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
                : BASE_CAPABILITIES,
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
        const entries = sessionId
            ? [[sessionId, this._terminals.get(sessionId)] as const]
            : Array.from(this._terminals.entries())
        for (const [id, items] of entries) {
            if (!items) {
                continue
            }
            for (const terminalId of Array.from(items.keys())) {
                await this.closeManagedTerminal(id, terminalId, 'killed')
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

function formatBackendUnavailable(status: ComputerBackendStatus) {
    if (status.error) {
        return `Computer backend ${status.type} is not available: ${status.error}`
    }

    return `Computer backend ${status.type} is disabled.`
}

const BASE_CAPABILITIES: ComputerCapability[] = [
    'file_read',
    'file_write',
    'file_edit',
    'file_publish',
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
    'e2b',
    'open-terminal',
    'local'
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
        name: 'file_publish',
        factory: (svc: ChatLunaAgentComputerService) => new PublishFileTool(svc)
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
