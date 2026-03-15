import { HumanMessage, SystemMessage } from '@langchain/core/messages'
import { computed, ComputedRef } from 'koishi-plugin-chatluna'
import {
    applyToolMask,
    createAgentExecutor,
    createToolsRef,
    SubagentContext,
    ToolMask
} from 'koishi-plugin-chatluna/llm-core/agent'
import { ChatLunaChatPrompt } from 'koishi-plugin-chatluna/llm-core/chain/prompt'
import {
    ChatLunaBaseEmbeddings,
    ChatLunaChatModel
} from 'koishi-plugin-chatluna/llm-core/platform/model'
import {
    countMessageTokens,
    PresetTemplate,
    PromptContextRuntime
} from 'koishi-plugin-chatluna/llm-core/prompt'
import {
    ChatLunaTool,
    ChatLunaToolRunnable
} from 'koishi-plugin-chatluna/llm-core/platform/types'
import { parseRawModelName } from 'koishi-plugin-chatluna/llm-core/utils/count_tokens'
import { getMessageContent } from 'koishi-plugin-chatluna/utils/string'
import { randomUUID } from 'crypto'
import { Context, h, Session } from 'koishi'
import {
    AgentConfig,
    SubAgentInfo,
    SubAgentRunInfo,
    SubAgentStatus,
    ToolGrantInfo
} from '../types'
import {
    renderAvailableSubAgents,
    renderSubAgentSystemPrompt
} from '../sub-agent/render'
import { renderAvailableSkills } from '../skills/render'
import {
    ensureSubAgentsRoot,
    getBuiltinAgents,
    scanMarkdownAgents
} from '../sub-agent/scan'
import { getPresetAgents } from '../sub-agent/preset'
import {
    createToolMask,
    filterNames,
    mergePermissions,
    mergeRule
} from '../sub-agent/permissions'
import { TaskTool } from '../sub-agent/tool'

export class ChatLunaAgentSubAgentService {
    private _catalog = new Map<string, SubAgentInfo>()
    private _runs = new Map<string, SubAgentRunInfo>()
    private _toolDispose?: () => void
    private _promptDispose?: () => void

    constructor(
        public ctx: Context,
        public config: AgentConfig
    ) {}

    async start() {
        await ensureSubAgentsRoot(this.ctx)
        await this.reload()
    }

    async stop() {
        this._toolDispose?.()
        this._toolDispose = undefined
        this._promptDispose?.()
        this._promptDispose = undefined
        this._catalog.clear()
        this._runs.clear()
    }

    async reload() {
        const items = await this.buildCatalog()
        this._catalog = new Map(items.map((item) => [item.id, item]))
        this.syncTool()
        this.syncPrompt()
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
        return 'Delegate a focused task to a specialized sub-agent when parallel work, deeper investigation, or a narrower prompt will help. Use the exact sub-agent name from the injected catalog and give it a self-contained prompt.'
    }

    getToolGrants(): ToolGrantInfo[] {
        const registry = this.ctx.chatluna.platform.getToolRegistry()
        const result = Object.values(registry)
            .map((item) => ({
                name: item.name,
                source: item.meta?.source,
                group: item.meta?.group,
                tags: item.meta?.tags,
                agents: [] as string[]
            }))
            .sort((a, b) => a.name.localeCompare(b.name))

        for (const agent of this.listRunnableAgents()) {
            const mask = createToolMask(agent, registry)
            for (const tool of result) {
                if (applyToolMask(tool.name, mask)) {
                    tool.agents.push(agent.name)
                }
            }
        }

        return result
    }

    async runTask(
        input: { agent: string; prompt: string; reason?: string },
        runConfig?: ChatLunaToolRunnable
    ) {
        const parent = runConfig?.configurable?.subagentContext
        if (parent && parent.depth >= parent.maxDepth) {
            return `Cannot delegate: maximum nesting depth (${parent.maxDepth}) reached.`
        }

        const agent = this.findRunnableAgent(input.agent)
        if (!agent) return `Sub-agent '${input.agent}' is not available.`

        const session = runConfig?.configurable?.session
        const conversationId = runConfig?.configurable?.conversationId
        if (!session || !conversationId) {
            return 'Sub-agent invocation is missing session context.'
        }

        const prompt = input.reason?.trim()
            ? `Reason: ${input.reason.trim()}\n\nTask:\n${input.prompt}`
            : input.prompt

        return await this.runSubAgent({
            agentId: agent.id,
            prompt,
            session,
            parentConversationId: conversationId,
            parentSubagentContext: parent,
            model: runConfig?.configurable?.model
        })
    }

    async runSubAgent(options: RunSubAgentOptions): Promise<string> {
        const info = this._catalog.get(options.agentId)
        if (!info || !isRunnable(info)) {
            throw new Error(`Sub-agent is not available: ${options.agentId}`)
        }

        const maxDepth = options.parentSubagentContext?.maxDepth ?? 1
        const depth = (options.parentSubagentContext?.depth ?? 0) + 1
        if (options.parentSubagentContext && depth > maxDepth) {
            throw new Error(`Maximum sub-agent depth ${maxDepth} reached`)
        }

        const runId = randomUUID()
        const conversationId = `subagent:${runId}`
        const registry = this.ctx.chatluna.platform.getToolRegistry()
        const mask = createToolMask(info, registry)

        const subCtx = {
            agentId: info.id,
            agentName: info.name,
            parentConversationId: options.parentConversationId,
            depth,
            maxDepth,
            toolMask: mask,
            disableHandoff: depth >= maxDepth,
            traceInfo: {
                runId,
                parentAgent: options.parentSubagentContext?.agentName ?? 'main',
                startedAt: Date.now()
            }
        } satisfies SubagentContext

        const run: SubAgentRunInfo = {
            runId,
            agentId: info.id,
            agentName: info.name,
            parentConversationId: options.parentConversationId,
            depth,
            state: 'running',
            startedAt: Date.now(),
            toolCount: 0,
            turnCount: 0
        }
        this._runs.set(runId, run)
        await this.ctx.chatluna_agent?.refreshConsoleData()

        try {
            const output = await this.executeAgent(
                info,
                options,
                conversationId,
                subCtx,
                mask,
                run
            )
            run.state = 'completed'
            run.endedAt = Date.now()
            await this.ctx.chatluna_agent?.refreshConsoleData()
            this.scheduleRunCleanup(runId)
            return String(output ?? '')
        } catch (err) {
            run.state = options.signal?.aborted ? 'aborted' : 'failed'
            run.error = err instanceof Error ? err.message : String(err)
            run.endedAt = Date.now()
            await this.ctx.chatluna_agent?.refreshConsoleData()
            this.scheduleRunCleanup(runId)
            throw err
        }
    }

    // ------------------------------------------------------------------
    //  Private: catalog build
    // ------------------------------------------------------------------

    private async buildCatalog() {
        const items = [
            ...getBuiltinAgents(this.config.subAgent),
            ...(await scanMarkdownAgents(this.ctx, this.config.subAgent)),
            ...getPresetAgents(this.ctx, this.config.subAgent)
        ].map((item) => ({
            ...item,
            permissions: mergePermissions(
                item.permissions,
                this.config.subAgent.defaults
            )
        }))

        const groups = new Map<string, SubAgentInfo[]>()
        for (const item of items) {
            const list = groups.get(item.name) ?? []
            list.push(item)
            groups.set(item.name, list)
        }

        const result: SubAgentInfo[] = []
        for (const list of groups.values()) {
            list.sort((a, b) => a.priority - b.priority)
            const winner = list.find(
                (item) => item.enabled && item.state === 'ready'
            )
            for (const item of list) {
                result.push({
                    ...item,
                    shadowedBy:
                        winner && winner.id !== item.id ? winner.id : undefined
                })
            }
        }

        return result.sort((a, b) => {
            if (a.priority !== b.priority) return a.priority - b.priority
            return a.name.localeCompare(b.name)
        })
    }

    // ------------------------------------------------------------------
    //  Private: agent execution
    // ------------------------------------------------------------------

    private async executeAgent(
        info: SubAgentInfo,
        options: RunSubAgentOptions,
        conversationId: string,
        subCtx: SubagentContext,
        mask: ToolMask,
        run: SubAgentRunInfo
    ) {
        const llm = await this.resolveModel(info, options.model)
        const embeddings = await this.resolveEmbeddings()
        const skills = await this.resolveSkillPrompt(info)
        const systemPrompt = renderSubAgentSystemPrompt(info, subCtx, skills)

        const preset = computed(
            () =>
                ({
                    triggerKeyword: [info.name],
                    rawText: systemPrompt,
                    messages: systemPrompt
                        ? [new SystemMessage(systemPrompt)]
                        : [],
                    config:
                        info.promptMode === 'preset' && info.preset
                            ? (this.ctx.chatluna.preset.getPreset(info.preset)
                                  .value?.config ?? {})
                            : {}
                }) satisfies PresetTemplate
        )

        const chatPrompt = computed(
            () =>
                new ChatLunaChatPrompt({
                    preset,
                    tokenCounter: (text) => llm.getNumTokens(text),
                    sendTokenLimit:
                        llm.invocationParams().maxTokenLimit ??
                        llm.getModelMaxContextSize(),
                    contextManager: this.ctx.chatluna.contextManager,
                    promptRenderService: this.ctx.chatluna.promptRenderer
                })
        )

        const toolRef = createToolsRef({
            tools: this.createTools(mask),
            embeddings,
            toolMask: mask
        })

        const executor = createAgentExecutor({
            llm: computed(() => llm),
            tools: toolRef.tools,
            prompt: chatPrompt.value,
            agentMode: 'tool-calling',
            returnIntermediateSteps: false,
            handleParsingErrors: true,
            instructions: computed(() => undefined)
        })

        const msg = await this.createMessage(
            info,
            options.prompt,
            options.session,
            llm.modelName
        )
        toolRef.update(options.session, [msg])

        const vars = {
            prompt: getMessageContent(msg.content),
            built: { conversationId }
        }

        const result = await executor.value.invoke(
            {
                input: msg,
                chat_history: [],
                variables: vars,
                variables_hide: vars,
                configurable: {
                    session: options.session,
                    conversationId,
                    subagentContext: subCtx
                }
            },
            {
                signal: options.signal,
                configurable: {
                    session: options.session,
                    model: llm,
                    conversationId,
                    preset: info.name,
                    userId: options.session.userId,
                    subagentContext: subCtx,
                    onAgentEvent: async (event) => {
                        if (event.type === 'tool-call') {
                            run.toolCount += event.actions.length
                            run.lastTool =
                                event.actions[event.actions.length - 1]?.tool
                        }
                        if (event.type === 'round-decision') {
                            run.turnCount += 1
                        }
                        await this.ctx.chatluna_agent?.refreshConsoleData()
                    }
                }
            }
        )

        return result.output
    }

    // ------------------------------------------------------------------
    //  Private: resource resolution
    // ------------------------------------------------------------------

    private createTools(mask: ToolMask): ComputedRef<ChatLunaTool[]> {
        return computed(() =>
            this.ctx.chatluna.platform
                .getFilteredTools(mask)
                .map((name) => this.ctx.chatluna.platform.getTool(name))
        )
    }

    private async resolveModel(info: SubAgentInfo, parent?: ChatLunaChatModel) {
        if (!info.model) {
            if (!parent) {
                throw new Error(
                    'Parent model is missing for sub-agent inheritance'
                )
            }
            return parent
        }

        const ref = await this.ctx.chatluna.createChatModel(info.model)
        if (!ref.value) throw new Error(`Model not found: ${info.model}`)
        return ref.value
    }

    private async resolveEmbeddings() {
        const [platform, model] = parseRawModelName(
            this.ctx.chatluna.config.defaultEmbeddings
        )
        const ref = await this.ctx.chatluna.createEmbeddings(platform, model)
        return ref.value as ChatLunaBaseEmbeddings
    }

    private async resolveSkillPrompt(info: SubAgentInfo) {
        const service = this.ctx.chatluna_agent?.skills
        if (!service) return undefined

        const skills = service.listSkills().filter((s) => s.modelEnabled)
        const names = skills.map((s) => s.name)
        const rule = mergeRule(
            info.permissions.skills,
            this.config.subAgent.defaults.skills
        )
        const list = rule.mode === 'inherit' ? [] : filterNames(names, rule)
        if (list.length < 1) return undefined

        return getMessageContent(
            renderAvailableSkills(
                skills.filter((item) => list.includes(item.name)),
                []
            ).content
        )
    }

    private async createMessage(
        info: SubAgentInfo,
        prompt: string,
        session: Session,
        modelName: string
    ) {
        if (!info.allowKoishiMessageTransform) {
            return new HumanMessage(prompt)
        }

        const msg = await this.ctx.chatluna.messageTransformer.transform(
            session,
            h.parse(prompt),
            modelName
        )
        return new HumanMessage({
            content: msg.content,
            name: msg.name,
            id: session.userId,
            additional_kwargs: { ...msg.additional_kwargs }
        })
    }

    // ------------------------------------------------------------------
    //  Private: tool & prompt sync
    // ------------------------------------------------------------------

    private syncTool() {
        this._toolDispose?.()
        this._toolDispose = undefined

        const names = this.listRunnableAgents().map((item) => item.name)
        if (names.length < 1) return

        this._toolDispose = this.ctx.chatluna.platform.registerTool('task', {
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

                const msg = renderAvailableSubAgents(agents)
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

    private scheduleRunCleanup(runId: string) {
        this.ctx.setTimeout(
            async () => {
                this._runs.delete(runId)
                await this.ctx.chatluna_agent?.refreshConsoleData()
            },
            30 * 60 * 1000
        )
    }
}

interface RunSubAgentOptions {
    agentId: string
    prompt: string
    session: Session
    parentConversationId: string
    parentSubagentContext?: SubagentContext
    signal?: AbortSignal
    model?: ChatLunaChatModel
}

function isRunnable(info: SubAgentInfo) {
    return (
        info.enabled &&
        info.state === 'ready' &&
        !info.hidden &&
        !info.shadowedBy
    )
}
