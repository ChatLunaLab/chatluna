/** @module service/sub_agent */

import { Context } from 'koishi'
import {
    type AgentTaskResolveContext,
    type AgentTaskToolRuntime,
    createTaskTool,
    renderAvailableAgents,
    type ToolMask
} from 'koishi-plugin-chatluna/llm-core/agent'
import { ChatLunaToolRunnable } from 'koishi-plugin-chatluna/llm-core/platform/types'
import {
    countMessageTokens,
    PromptContextRuntime
} from 'koishi-plugin-chatluna/llm-core/prompt'
import { getSubAgentsRootPath } from '../config/path'
import { buildSubAgentCatalog } from '../sub-agent/catalog'
import { createManualAgent } from '../sub-agent/manual'
import { createSubAgent } from '../sub-agent/run'
import { ensureSubAgentsRoot, REMOTE_SUBAGENTS_ROOT } from '../sub-agent/scan'
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
    private _task: AgentTaskToolRuntime

    constructor(
        public ctx: Context,
        public config: AgentConfig,
        private permission: ChatLunaAgentPermissionService
    ) {
        this._task = this._createTaskRuntime()
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
        return this._task.getRuns() as SubAgentRunInfo[]
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
        return this.getCatalogSync().find(
            (item) =>
                item.name === name &&
                isRunnable(item) &&
                this.permission.canUseSubAgent(item, session, source)
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

                const mask = this.permission.createSubAgentToolMask(info)

                return {
                    agent: await createSubAgent({
                        ctx: this.ctx,
                        permission: this.permission,
                        info,
                        mask,
                        model: ctx.runConfig?.configurable?.model
                    }),
                    toolMask: mask
                }
            },
            refresh: async () => {
                await this.ctx.chatluna_agent?.refreshConsoleData()
            }
        })
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

    private syncTool() {
        this._toolDispose?.()
        this._toolDispose = undefined

        const names = this.listRunnableAgents().map((item) => item.name)
        if (names.length < 1) return

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
                const conversationId = runtime.configurable?.conversationId
                if (!conversationId) return next()

                if (runtime.configurable?.subagentContext) return next()

                const session = runtime.configurable?.session
                const source =
                    (
                        runtime.configurable as {
                            source?: 'chatluna' | 'character'
                        }
                    )?.source ?? 'chatluna'

                const mask = (runtime.configurable as { toolMask?: ToolMask })
                    ?.toolMask
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
