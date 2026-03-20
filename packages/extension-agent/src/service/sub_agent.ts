/** @module service/sub_agent */

import { randomUUID } from 'crypto'
import { HumanMessage } from '@langchain/core/messages'
import { Context } from 'koishi'
import {
    MessageQueue,
    SubagentContext
} from 'koishi-plugin-chatluna/llm-core/agent'
import { ChatLunaToolRunnable } from 'koishi-plugin-chatluna/llm-core/platform/types'
import {
    countMessageTokens,
    PromptContextRuntime
} from 'koishi-plugin-chatluna/llm-core/prompt'
import { getSubAgentsRootPath } from '../config/path'
import { buildSubAgentCatalog } from '../sub-agent/catalog'
import { createManualAgent } from '../sub-agent/manual'
import { renderAvailableSubAgents } from '../sub-agent/render'
import {
    ActiveSubAgentRun,
    clearDisposers,
    isRunnable,
    RunSubAgentOptions
} from '../sub-agent/runtime'
import { runSubAgentTurn } from '../sub-agent/run'
import {
    createTaskSession,
    formatTaskDetail,
    formatTaskList,
    formatTaskResult,
    formatTaskStart,
    SubAgentTaskSession,
    touchTaskSession
} from '../sub-agent/session'
import { ensureSubAgentsRoot, REMOTE_SUBAGENTS_ROOT } from '../sub-agent/scan'
import { TaskTool } from '../sub-agent/tool'
import {
    AgentConfig,
    ManualSubAgentInput,
    ManualSubAgentRegistration,
    SubAgentInfo,
    SubAgentRunInfo,
    SubAgentStatus
} from '../types'
import { ChatLunaAgentPermissionService } from './permissions'

export class ChatLunaAgentSubAgentService {
    private _catalog = new Map<string, SubAgentInfo>()
    private _runs = new Map<string, SubAgentRunInfo>()
    private _manual = new Map<string, ManualSubAgentInput>()
    private _tasks = new Map<string, SubAgentTaskSession>()
    private _active = new Map<string, ActiveSubAgentRun>()
    private _toolDispose?: () => void
    private _promptDispose?: () => void
    private _runDispose = new Map<string, () => void>()
    private _taskDispose = new Map<string, () => void>()

    constructor(
        public ctx: Context,
        public config: AgentConfig,
        private permission: ChatLunaAgentPermissionService
    ) {}

    async start() {
        await ensureSubAgentsRoot(this.ctx)
        await this.refreshCatalog()
    }

    async stop() {
        for (const item of this._active.values()) {
            item.abort.abort()
        }

        this._active.clear()
        this._toolDispose?.()
        this._toolDispose = undefined
        this._promptDispose?.()
        this._promptDispose = undefined
        clearDisposers(this._runDispose)
        clearDisposers(this._taskDispose)
        this._catalog.clear()
        this._runs.clear()
        this._manual.clear()
        this._tasks.clear()
    }

    async reload() {
        await this.refreshCatalog()
    }

    getStatus(): SubAgentStatus {
        const catalog = this.getCatalogSync()
        return {
            enabled: catalog.length > 0,
            total: catalog.length,
            catalog: Object.fromEntries(catalog.map((item) => [item.id, item])),
            runs: this.getRuns()
        }
    }

    getCatalogSync() {
        return [...this._catalog.values()].sort((a, b) => {
            if (a.priority !== b.priority) return a.priority - b.priority
            return a.name.localeCompare(b.name)
        })
    }

    getRuns() {
        return [...this._runs.values()].sort(
            (a, b) => b.startedAt - a.startedAt
        )
    }

    listRunnableAgents() {
        return this.getCatalogSync().filter(isRunnable)
    }

    findRunnableAgent(name: string) {
        return this.getCatalogSync().find(
            (item) => item.name === name && isRunnable(item)
        )
    }

    buildToolDescription() {
        return [
            'Delegate a focused task to a specialized sub-agent when parallel work, deeper investigation, or a narrower prompt will help.',
            'Use the exact sub-agent name from the injected catalog.',
            'If delegated work may take a while, set background=true so it can continue beyond the normal tool timeout.',
            'Use action=list or action=status to inspect background tasks, action=message to send more guidance while they run, and action=run with the same id to continue the same session later.'
        ].join('\n')
    }

    async registerManualAgent(
        input: ManualSubAgentInput
    ): Promise<ManualSubAgentRegistration> {
        const prev = input.id?.trim()
            ? this._manual.get(input.id.trim())
            : undefined
        const next = {
            ...prev,
            ...input,
            id: input.id?.trim() || prev?.id
        } satisfies ManualSubAgentInput
        const info = createManualAgent(this.ctx, next)

        this._manual.set(info.id, {
            ...next,
            id: info.id
        })

        await this.refreshCatalog()
        await this.ctx.chatluna_agent?.refreshConsoleData()
        return {
            agent: this._catalog.get(info.id) ?? info,
            dispose: async () => {
                await this.disposeManualAgent(info.id)
            }
        }
    }

    async setManualAgentEnabled(id: string, enabled: boolean) {
        const input = this._manual.get(id)
        if (!input) {
            throw new Error(`Manual sub-agent not found: ${id}`)
        }

        return await this.registerManualAgent({
            ...input,
            id,
            enabled
        })
    }

    async removeManualAgent(id: string) {
        if (!(await this.disposeManualAgent(id))) {
            throw new Error(`Manual sub-agent not found: ${id}`)
        }
    }

    async runTask(
        input: {
            action?: 'run' | 'status' | 'list' | 'message'
            agent?: string
            id?: string
            prompt?: string
            reason?: string
            background?: boolean
            message?: string
        },
        runConfig?: ChatLunaToolRunnable
    ) {
        const action = input.action ?? 'run'
        const parent = runConfig?.configurable?.subagentContext
        const session = runConfig?.configurable?.session
        const conversationId = runConfig?.configurable?.conversationId

        if (action === 'list') {
            if (!conversationId) {
                return 'Sub-agent invocation is missing conversation context.'
            }

            const tasks = [...this._tasks.values()]
                .filter((item) => item.parentConversationId === conversationId)
                .sort((a, b) => b.updatedAt - a.updatedAt)

            if (tasks.length < 1) {
                return 'No sub-agent tasks in this conversation.'
            }

            return formatTaskList(tasks, (taskId) =>
                this.getLatestTaskRun(taskId)
            )
        }

        const id = input.id?.trim()
        const task = id ? this._tasks.get(id) : undefined
        if (id && !task) {
            return `Sub-agent task '${input.id}' was not found or expired.`
        }

        if (task && !conversationId) {
            return 'Sub-agent invocation is missing conversation context.'
        }

        if (task && task.parentConversationId !== conversationId) {
            return `Sub-agent task '${task.id}' belongs to a different conversation.`
        }

        if (action === 'status') {
            if (!task) {
                return 'Sub-agent task id is required for action=status.'
            }

            touchTaskSession(task)
            this.scheduleTaskCleanup(task.id)
            return formatTaskDetail(task, this.getLatestTaskRun(task.id))
        }

        if (action === 'message') {
            if (!task) {
                return 'Sub-agent task id is required for action=message.'
            }

            if (!task?.activeRunId) {
                return `Sub-agent task '${task.id}' is not running. Use action=run with the same id to continue it.`
            }

            const active = this._active.get(task.activeRunId)
            if (!active) {
                return `Sub-agent task '${task.id}' is not accepting live messages because it was not started in background.`
            }

            active.queue.push(new HumanMessage(input.message!.trim()))
            touchTaskSession(task)
            this.scheduleTaskCleanup(task.id)
            await this.ctx.chatluna_agent?.refreshConsoleData()

            return [
                `task_id: ${task.id}`,
                `run_id: ${task.activeRunId}`,
                'state: running',
                'message: queued',
                `status_hint: use task with {"action":"status","id":"${task.id}"} to inspect progress.`
            ].join('\n')
        }

        if (parent && parent.depth >= parent.maxDepth) {
            return `Cannot delegate: maximum nesting depth (${parent.maxDepth}) reached.`
        }

        if (!session || !conversationId) {
            return 'Sub-agent invocation is missing session context.'
        }

        let info = task ? this._catalog.get(task.agentId) : undefined
        if (input.agent?.trim()) {
            info = this.findRunnableAgent(input.agent.trim())
            if (!info) {
                return `Sub-agent '${input.agent}' is not available.`
            }
        }

        if (!task && !info) {
            return 'agent is required when starting a new sub-agent task.'
        }

        if (task && info && task.agentId !== info.id) {
            return `Sub-agent task '${task.id}' belongs to '${task.agentName}', not '${input.agent}'.`
        }

        if (!info || !isRunnable(info)) {
            return `Sub-agent '${input.agent ?? task?.agentName}' is not available.`
        }

        const next = task ?? this.createTask(info, conversationId, parent)
        if (next.activeRunId) {
            return `Sub-agent task '${next.id}' is already running. Use action=status to inspect it or action=message to guide it while it runs in background.`
        }

        const raw = input.prompt?.trim()
        if (!raw) {
            return 'Sub-agent prompt is empty.'
        }

        const prompt = input.reason?.trim()
            ? `Reason: ${input.reason.trim()}\n\nTask:\n${raw}`
            : raw

        touchTaskSession(next)
        this.scheduleTaskCleanup(next.id)

        try {
            return await this.runSubAgent({
                agentId: info.id,
                prompt,
                session,
                parentConversationId: conversationId,
                parentSubagentContext: parent,
                model: runConfig?.configurable?.model,
                task: next,
                background: input.background === true
            })
        } catch (err) {
            const run = this.getLatestTaskRun(next.id)
            if (!run) {
                throw err
            }

            return formatTaskResult(
                next,
                run,
                err instanceof Error ? err.message : String(err)
            )
        }
    }

    async runSubAgent(options: RunSubAgentOptions): Promise<string> {
        const info = this._catalog.get(options.agentId)
        if (!info || !isRunnable(info)) {
            throw new Error(`Sub-agent is not available: ${options.agentId}`)
        }

        const task =
            options.task ??
            this.createTask(
                info,
                options.parentConversationId,
                options.parentSubagentContext
            )

        if (task.activeRunId) {
            throw new Error(`Sub-agent task '${task.id}' is already running.`)
        }

        const runId = randomUUID()
        const mask = this.permission.createSubAgentToolMask(info)

        const subCtx = {
            agentId: info.id,
            agentName: info.name,
            parentConversationId: task.parentConversationId,
            depth: task.depth,
            maxDepth: task.maxDepth,
            toolMask: mask,
            disableHandoff: task.depth >= task.maxDepth,
            traceInfo: {
                runId,
                parentAgent: task.parentAgent,
                startedAt: Date.now()
            }
        } satisfies SubagentContext

        const run: SubAgentRunInfo = {
            runId,
            taskId: task.id,
            agentId: info.id,
            agentName: info.name,
            conversationId: task.conversationId,
            parentConversationId: task.parentConversationId,
            depth: task.depth,
            state: 'running',
            background: options.background,
            startedAt: Date.now(),
            toolCount: 0,
            turnCount: 0
        }

        const abort = options.background ? new AbortController() : undefined
        const queue = options.background ? new MessageQueue() : undefined
        const signal = abort?.signal ?? options.signal

        task.activeRunId = runId
        this._runs.set(runId, run)
        if (abort && queue) {
            this._active.set(runId, { abort, queue })
        }
        this.scheduleTaskCleanup(task.id)
        await this.ctx.chatluna_agent?.refreshConsoleData()

        const exec = async () => {
            try {
                const result = await runSubAgentTurn({
                    ctx: this.ctx,
                    permission: this.permission,
                    info,
                    prompt: options.prompt,
                    session: options.session,
                    task,
                    subCtx,
                    mask,
                    run,
                    signal,
                    model: options.model,
                    messageQueue: queue,
                    refresh: async () => {
                        await this.ctx.chatluna_agent?.refreshConsoleData()
                    }
                })
                run.state = 'completed'
                run.output = String(result.output ?? '')
                run.endedAt = Date.now()
                delete task.activeRunId
                touchTaskSession(task)
                await this.ctx.chatluna_agent?.refreshConsoleData()
                this.scheduleRunCleanup(runId)
                this.scheduleTaskCleanup(task.id)
                return formatTaskResult(task, run, run.output)
            } catch (err) {
                run.state = signal?.aborted ? 'aborted' : 'failed'
                run.error = err instanceof Error ? err.message : String(err)
                run.endedAt = Date.now()
                delete task.activeRunId
                touchTaskSession(task)
                await this.ctx.chatluna_agent?.refreshConsoleData()
                this.scheduleRunCleanup(runId)
                this.scheduleTaskCleanup(task.id)
                throw err
            } finally {
                this._active.delete(runId)
            }
        }

        if (options.background) {
            exec().catch((err) => {
                this.ctx.logger.error(err)
            })
            return formatTaskStart(task, run)
        }

        return await exec()
    }

    private async refreshCatalog() {
        const remote = this.ctx.chatluna_agent
            ? await this.ctx.chatluna_agent.computer
                  .scanRemoteSubAgents()
                  .catch(() => [])
            : []
        const items = await buildSubAgentCatalog(
            this.ctx,
            this.config.subAgent,
            this.permission,
            this._manual.values(),
            remote
        )
        this._catalog = new Map(items.map((item) => [item.id, item]))
        this.syncTool()
        this.syncPrompt()
    }

    private createTask(
        info: SubAgentInfo,
        parentConversationId: string,
        parent?: SubagentContext
    ) {
        const maxDepth = parent?.maxDepth ?? 1
        const depth = (parent?.depth ?? 0) + 1
        if (parent && depth > maxDepth) {
            throw new Error(`Maximum sub-agent depth ${maxDepth} reached`)
        }

        const task = createTaskSession({
            id: randomUUID(),
            info,
            parentConversationId,
            depth,
            maxDepth,
            parentAgent: parent?.agentName ?? 'main'
        })
        this._tasks.set(task.id, task)
        this.scheduleTaskCleanup(task.id)
        return task
    }

    private getLatestTaskRun(taskId: string) {
        return [...this._runs.values()]
            .filter((item) => item.taskId === taskId)
            .sort((a, b) => b.startedAt - a.startedAt)[0]
    }

    private syncTool() {
        this._toolDispose?.()
        this._toolDispose = undefined

        const names = this.listRunnableAgents().map((item) => item.name)
        if (names.length < 1) return

        this._toolDispose = this.ctx.chatluna.platform.registerTool('task', {
            description: this.buildToolDescription(),
            selector: () => this.listRunnableAgents().length > 0,
            authorization: () => true,
            createTool: () => new TaskTool(this),
            meta: {
                source: 'extension',
                group: 'agent',
                tags: ['handoff']
            }
        })
    }

    private syncPrompt() {
        this._promptDispose?.()
        this._promptDispose = undefined

        this._promptDispose = this.ctx.chatluna.contextManager.pipeline(
            'after_system_prompts',
            async (runtime: PromptContextRuntime, next) => {
                const conversationId = runtime.configurable?.conversationId
                if (!conversationId) return next()

                if (runtime.configurable?.subagentContext) return next()

                const agents = this.listRunnableAgents()
                if (agents.length < 1) return next()

                const status = this.ctx.chatluna_agent?.computer.getStatus()
                const remote =
                    status != null && status.defaultProvider !== 'local'

                const msg = renderAvailableSubAgents(
                    agents,
                    remote
                        ? REMOTE_SUBAGENTS_ROOT
                        : getSubAgentsRootPath(this.ctx),
                    remote ? 'remote' : 'local'
                )
                runtime.result.push(msg)
                runtime.usedTokens += await countMessageTokens(
                    msg,
                    runtime.tokenCounter
                )
                return next()
            },
            0
        )
    }

    private scheduleRunCleanup(runId: string, timeout = 30 * 60 * 1000) {
        this.cancelRunCleanup(runId)
        this._runDispose.set(
            runId,
            this.ctx.setTimeout(async () => {
                this._runDispose.delete(runId)
                this._runs.delete(runId)
                await this.ctx.chatluna_agent?.refreshConsoleData()
            }, timeout)
        )
    }

    private cancelRunCleanup(runId: string) {
        this._runDispose.get(runId)?.()
        this._runDispose.delete(runId)
    }

    private scheduleTaskCleanup(taskId: string, timeout = 30 * 60 * 1000) {
        this.cancelTaskCleanup(taskId)
        this._taskDispose.set(
            taskId,
            this.ctx.setTimeout(async () => {
                this._taskDispose.delete(taskId)
                const task = this._tasks.get(taskId)
                if (!task) {
                    return
                }

                if (task.activeRunId) {
                    this.scheduleTaskCleanup(taskId, timeout)
                    return
                }

                this._tasks.delete(taskId)

                for (const run of [...this._runs.values()]) {
                    if (run.taskId !== taskId) {
                        continue
                    }

                    this.cancelRunCleanup(run.runId)
                    this._runs.delete(run.runId)
                }

                await this.ctx.chatluna_agent?.refreshConsoleData()
            }, timeout)
        )
    }

    private cancelTaskCleanup(taskId: string) {
        this._taskDispose.get(taskId)?.()
        this._taskDispose.delete(taskId)
    }

    private async disposeManualAgent(id: string) {
        if (!this._manual.delete(id)) {
            return false
        }

        await this.refreshCatalog()
        await this.ctx.chatluna_agent?.refreshConsoleData()
        return true
    }
}
