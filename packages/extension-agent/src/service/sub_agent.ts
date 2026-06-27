/** @module service/sub_agent */

import { Context } from 'koishi'
import {
    type AgentTaskResolveContext,
    type AgentTaskSession,
    type AgentTaskToolRuntime,
    createTaskTool,
    renderAvailableAgents
} from 'koishi-plugin-chatluna/llm-core/agent'
import { ChatLunaToolRunnable } from 'koishi-plugin-chatluna/llm-core/platform/types'
import {
    countMessageTokens,
    PromptContextRuntime
} from 'koishi-plugin-chatluna/llm-core/prompt'
import { getMessageContent } from 'koishi-plugin-chatluna/utils/string'
import { getSubAgentsRootPath } from '../config/path'
import { buildSubAgentCatalog } from '../sub-agent/catalog'
import { createManualAgent } from '../sub-agent/manual'
import { createSubAgent } from '../sub-agent/run'
import { ensureSubAgentsRoot, REMOTE_SUBAGENTS_ROOT } from '../sub-agent/scan'
import { ChatLunaAgentTaskAttachService } from '../sub-agent/task_attach'
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
    private _manual = new Map<string, ManualSubAgentInput>()
    private _toolDispose?: () => void
    private _promptDispose?: () => void
    private _attach: ChatLunaAgentTaskAttachService
    private _task: AgentTaskToolRuntime

    constructor(
        public ctx: Context,
        public config: AgentConfig,
        private permission: ChatLunaAgentPermissionService
    ) {
        this._task = this._createTaskRuntime()
        this._attach = new ChatLunaAgentTaskAttachService(this.ctx)
        this.ctx.on('chatluna/chat-stopped', async ({ conversationId }) => {
            if (
                (await this._task.abortByParentConversation(conversationId)) > 0
            ) {
                await this.ctx.chatluna_agent?.refreshConsoleData()
            }
        })
        this.ctx.on(
            'chatluna/before-conversation-clear-history',
            async ({ conversation }) => {
                if (
                    (await this._task.abortByParentConversation(
                        conversation.id
                    )) > 0
                ) {
                    await this.ctx.chatluna_agent?.refreshConsoleData()
                }
            }
        )
    }

    async start() {
        await ensureSubAgentsRoot(this.ctx)
        await this.refreshCatalog()
    }

    async stop() {
        await this._task.dispose()
        this._toolDispose?.()
        this._toolDispose = undefined
        this._promptDispose?.()
        this._promptDispose = undefined
        this._catalog.clear()
        this._manual.clear()
    }

    async reload() {
        await this.refreshCatalog()
    }

    getStatus(): SubAgentStatus {
        const items = this.getCatalogSync()
        return {
            enabled: items.length > 0,
            total: items.length,
            catalog: Object.fromEntries(items.map((item) => [item.id, item])),
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
        return this._task.getRuns() as SubAgentRunInfo[]
    }

    getTasks() {
        return this._task.getTasks()
    }

    getTask(id: string) {
        return this._task.getTask(id)
    }

    getLatestRunningTask(filter?: (t: AgentTaskSession) => boolean) {
        const runs = this.getRuns()
        return this.getTasks()
            .filter(
                (t) =>
                    t.activeRunId &&
                    runs.find((r) => r.taskId === t.id)?.state === 'running' &&
                    (filter?.(t) ?? true)
            )
            .sort((a, b) => b.startedAt - a.startedAt)[0]
    }

    async stopTask(id: string) {
        const result = await this._task.stopTask(id)
        if (result) this.ctx.chatluna_agent?.refreshConsoleData()
        return result
    }

    async stopTaskTree(id: string) {
        const task = this._task.getTask(id)
        if (!task) return 0

        const list = this._task.getTasks()
        const pending = [task]
        const seen = new Set<string>()
        let count = 0

        while (pending.length > 0) {
            const item = pending.shift()!
            if (seen.has(item.id)) continue
            seen.add(item.id)
            pending.push(
                ...list.filter(
                    (child) =>
                        child.parentConversationId === item.conversationId
                )
            )

            if (await this._task.stopTask(item.id)) {
                this.detachAttachedTask(item.id)
                count += 1
            }
        }

        if (count > 0) this.ctx.chatluna_agent?.refreshConsoleData()
        return count
    }

    async pauseTask(id: string) {
        const result = await this._task.pauseTask(id)
        if (result) this.ctx.chatluna_agent?.refreshConsoleData()
        return result
    }

    async resumeTask(id: string) {
        const result = await this._task.resumeTask(id)
        if (result) this.ctx.chatluna_agent?.refreshConsoleData()
        return result
    }

    async abortByParentConversation(id: string) {
        const result = await this._task.abortByParentConversation(id)
        if (result > 0) this.ctx.chatluna_agent?.refreshConsoleData()
        return result
    }

    async chatTask(id: string, prompt: string, ctx: AgentTaskResolveContext) {
        return await this._task.chatTask(id, prompt, ctx)
    }

    attachTask(
        session: Parameters<ChatLunaAgentTaskAttachService['attach']>[0],
        id: string,
        conversationId: string
    ) {
        this._attach.attach(session, id, conversationId)
    }

    detachTaskAttach(
        session: Parameters<ChatLunaAgentTaskAttachService['detach']>[0]
    ) {
        return this._attach.detach(session)
    }

    detachAttachedTask(id: string) {
        this._attach.detachTask(id)
    }

    getTaskHistory(task: AgentTaskSession) {
        const lines = task.messages
            .map((msg) => {
                const text = getMessageContent(msg.content)
                    .replace(/\s+/g, ' ')
                    .trim()
                if (!text) return undefined

                return `${msg.getType()}: ${text.length > 140 ? `${text.slice(0, 137)}...` : text}`
            })
            .filter((item): item is string => item != null)

        return lines.length < 1
            ? '(no messages yet)'
            : lines.slice(-3).join('\n')
    }

    listRunnableAgents(
        session?: Parameters<
            ChatLunaAgentPermissionService['canUseSubAgent']
        >[1],
        source?: Parameters<ChatLunaAgentPermissionService['canUseSubAgent']>[2]
    ) {
        return this.getCatalogSync().filter(
            (item) =>
                isRunnable(item) &&
                this.permission.canUseSubAgent(item, session, source)
        )
    }

    findRunnableAgent(
        name: string,
        session?: Parameters<
            ChatLunaAgentPermissionService['canUseSubAgent']
        >[1],
        source?: Parameters<ChatLunaAgentPermissionService['canUseSubAgent']>[2]
    ) {
        const items = this.getCatalogSync().filter(
            (item) =>
                isRunnable(item) &&
                this.permission.canUseSubAgent(item, session, source)
        )

        return (
            items.find((item) => item.name === name) ??
            items.find((item) => item.name.toLowerCase() === name.toLowerCase())
        )
    }

    buildToolDescription() {
        return this._task.buildToolDescription()
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

        this._manual.set(info.id, { ...next, id: info.id })

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
        input: Parameters<AgentTaskToolRuntime['runTask']>[0],
        runConfig?: ChatLunaToolRunnable
    ) {
        return await this._task.runTask(input, runConfig)
    }

    private _createTaskRuntime() {
        return createTaskTool({
            list: ({ session, source }) =>
                this.listRunnableAgents(session, source).map((item) => ({
                    id: item.id,
                    name: item.name,
                    description: item.description
                })),
            get: async (name, ctx) => {
                const info = this.findRunnableAgent(
                    name,
                    ctx.session,
                    ctx.source
                )

                if (!info) {
                    return undefined
                }

                return {
                    agent: await createSubAgent({
                        ctx: this.ctx,
                        permission: this.permission,
                        info,
                        model: ctx.runConfig?.configurable?.model
                    }),
                    toolMask: await this.permission.createSubAgentToolMask(
                        info,
                        ctx.session,
                        ctx.source ?? 'chatluna'
                    )
                }
            },
            refresh: async () => {
                await this.ctx.chatluna_agent?.refreshConsoleData()
            },
            onRunFinished: async (payload) => {
                await this.ctx.parallel('chatluna/agent-task-finished', payload)
                await this.ctx.chatluna_agent?.refreshConsoleData()
            }
        })
    }

    private async refreshCatalog() {
        const items = await buildSubAgentCatalog(
            this.ctx,
            this.config.subAgent,
            this.permission,
            this._manual.values()
        )
        this._catalog = new Map(items.map((item) => [item.id, item]))
        this.syncTool()
        this.syncPrompt()
    }

    private syncTool() {
        this._toolDispose?.()
        this._toolDispose = undefined

        if (this.listRunnableAgents().length < 1) return

        this._toolDispose = this.ctx.chatluna.platform.registerTool('task', {
            description: this.buildToolDescription(),
            selector: () => this.listRunnableAgents().length > 0,
            authorization: (session) =>
                this.listRunnableAgents(session, 'chatluna').length > 0,
            createTool: () => this._task.createTool(),
            meta: {
                source: 'extension',
                group: 'agent',
                tags: ['handoff'],
                defaultAvailability: {
                    enabled: true,
                    main: true,
                    chatluna: true,
                    characterScope: 'all'
                }
            }
        })
    }

    private syncPrompt() {
        this._promptDispose?.()
        this._promptDispose = undefined

        this._promptDispose = this.ctx.chatluna.contextManager.pipeline(
            'after_system_prompts',
            async (runtime: PromptContextRuntime, next) => {
                if (!runtime.configurable?.conversationId) return next()
                if (runtime.configurable?.subagentContext) return next()

                const session = runtime.configurable?.session
                const source = (runtime.configurable?.source ??
                    'chatluna') as Parameters<
                    ChatLunaAgentPermissionService['canUseSubAgent']
                >[2]

                const mask = runtime.configurable?.toolMask

                if (
                    mask != null &&
                    !this.ctx.chatluna.platform
                        .getFilteredTools(mask)
                        .includes('task')
                ) {
                    return next()
                }

                const agents = this.listRunnableAgents(session, source)
                if (agents.length < 1) return next()

                const status = this.ctx.chatluna_agent?.computer.getStatus()
                const remote =
                    status != null && status.defaultProvider !== 'local'

                const msg = renderAvailableAgents(
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

    private async disposeManualAgent(id: string) {
        if (!this._manual.delete(id)) {
            return false
        }

        await this.refreshCatalog()
        await this.ctx.chatluna_agent?.refreshConsoleData()
        return true
    }
}

function isRunnable(info: SubAgentInfo) {
    return (
        info.enabled &&
        info.state === 'ready' &&
        !info.hidden &&
        !info.shadowedBy
    )
}
