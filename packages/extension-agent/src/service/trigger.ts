import { SystemMessage } from '@langchain/core/messages'
import { type Context } from 'koishi'
import {
    countMessageTokens,
    PromptContextRuntime
} from 'koishi-plugin-chatluna/llm-core/prompt'
import {
    ChatLunaError,
    ChatLunaErrorCode
} from 'koishi-plugin-chatluna/utils/error'
import { logger } from '..'
import type {
    TriggerActor,
    TriggerCondition,
    TriggerCreateInput,
    TriggerListFilter,
    TriggerProviderDef,
    TriggerProviderMeta,
    TriggerRun,
    TriggerStatus,
    TriggerTask,
    TriggerUpdateInput,
    TriggerWakeupInput
} from '../types'
import { TriggerRunControl } from '../trigger/control'
import { TriggerObserver } from '../trigger/observer'
import { TriggerPlanner } from '../trigger/planner'
import { builtinProviderDefs } from '../trigger/providers/builtin'
import { TriggerProviderRegistry } from '../trigger/providers/registry'
import { TriggerRunner } from '../trigger/runner'
import { TriggerScheduler } from '../trigger/scheduler'
import {
    createTriggerCreateInputSchema,
    createTriggerUpdateInputSchema,
    finishTriggerRunSchema,
    isEventCondition,
    triggerWakeupInputSchema
} from '../trigger/schema'
import { gateCursor, toInvokeConversation } from '../trigger/shared'
import { TriggerStore } from '../trigger/store'
import { FinishTriggerRunTool, TriggerTool } from '../trigger/tool'

export class ChatLunaAgentTriggerService {
    private readonly _store: TriggerStore
    private readonly _registry = new TriggerProviderRegistry()
    private readonly _planner: TriggerPlanner
    private readonly _control: TriggerRunControl
    private readonly _runner: TriggerRunner
    private readonly _scheduler: TriggerScheduler
    private readonly _observer: TriggerObserver
    private _toolDispose?: () => void
    private _finishDispose?: () => void
    private _promptDispose?: () => void
    private _started = false
    private _status: TriggerStatus = {
        total: 0,
        enabled: 0,
        waiting: 0,
        running: 0,
        paused: 0,
        error: 0
    }

    constructor(public readonly ctx: Context) {
        for (const item of builtinProviderDefs) {
            this._registry.register(item)
        }
        this._store = new TriggerStore(ctx, () => this._registry)
        this._planner = new TriggerPlanner(this._registry)
        this._control = new TriggerRunControl()
        this._runner = new TriggerRunner(
            ctx,
            this._store,
            this._planner,
            this._control,
            {
                refresh: async () => await this._afterChange(),
                registry: this._registry
            }
        )
        this._scheduler = new TriggerScheduler(
            ctx,
            this._store,
            this._runner,
            this._registry
        )
        this._observer = new TriggerObserver(
            ctx,
            this._store,
            this._runner,
            this._scheduler,
            this._registry
        )
    }

    registerProvider(def: TriggerProviderDef) {
        if (builtinProviderDefs.some((item) => item.id === def.id)) {
            throw new ChatLunaError(
                ChatLunaErrorCode.TRIGGER_CONFLICT,
                new Error(
                    `Cannot override built-in trigger provider: ${def.id}`
                )
            )
        }
        return this._registry.register(def, (event) => {
            if (!this._started) return
            if (event === 'remove') {
                this._onProviderRemoved(def.id).catch((err) =>
                    logger.error(err)
                )
                return
            }
            this._afterChange().catch((err) => logger.error(err))
        })
    }

    listProviders(): TriggerProviderMeta[] {
        const builtinIds = new Set(builtinProviderDefs.map((item) => item.id))
        const builtin = builtinProviderDefs.map((item) =>
            this._registry.meta(item.id, true)
        )
        const custom = this._registry
            .list()
            .filter((item) => !builtinIds.has(item.id))
            .map((item) => this._registry.meta(item.id, false))
        return [...builtin, ...custom]
    }

    async start() {
        if (this._started) return
        this._started = true

        try {
            this._toolDispose = this.ctx.chatluna.platform.registerTool(
                'trigger',
                {
                    description: new TriggerTool(this).description,
                    selector: () => true,
                    authorization: () => true,
                    createTool: () => new TriggerTool(this),
                    meta: {
                        source: 'extension',
                        group: 'agent',
                        tags: ['trigger'],
                        defaultAvailability: {
                            enabled: true,
                            main: true,
                            chatluna: true,
                            characterScope: 'none'
                        }
                    }
                }
            )
            this._finishDispose = this.ctx.chatluna.platform.registerTool(
                'finish_trigger_run',
                {
                    description: new FinishTriggerRunTool(this._control)
                        .description,
                    selector: () => true,
                    authorization: () => true,
                    createTool: () => new FinishTriggerRunTool(this._control),
                    meta: {
                        source: 'extension',
                        group: 'agent',
                        tags: ['trigger', 'control'],
                        defaultAvailability: {
                            enabled: false,
                            main: false,
                            chatluna: false,
                            characterScope: 'none'
                        }
                    }
                }
            )
            this._promptDispose = this.ctx.chatluna.contextManager.pipeline(
                'after_system_prompts',
                async (runtime: PromptContextRuntime, next) => {
                    const agentContext = runtime.configurable?.agentContext
                    if (!agentContext?.conversationId) return next()
                    if (agentContext.kind === 'subagent') return next()

                    const mask = agentContext.toolMask
                    if (
                        mask != null &&
                        !this.ctx.chatluna.platform
                            .getFilteredTools(mask)
                            .includes('trigger')
                    ) {
                        return next()
                    }

                    const msg = new SystemMessage(
                        '<trigger_tool>Use the trigger tool for persistent ' +
                            'scheduled or message-driven tasks. Use structured ' +
                            'actions and inspect a task before changing it. ' +
                            'Immediate work that should not persist does not need ' +
                            'a trigger task.</trigger_tool>'
                    )
                    runtime.result.push(msg)
                    runtime.usedTokens += await countMessageTokens(
                        msg,
                        runtime.tokenCounter
                    )
                    return next()
                },
                10
            )

            this._runner.start()
            if (this.ctx.database == null) {
                this._status = {
                    total: 0,
                    enabled: 0,
                    waiting: 0,
                    running: 0,
                    paused: 0,
                    error: 0
                }
                return
            }
            await this._reconcileStale()
            await this._observer.start()
            await this._scheduler.start()
            await this._refreshStatus()
        } catch (err) {
            await this.stop()
            throw err
        }
    }

    async stop() {
        if (!this._started) return
        this._started = false

        await this._observer.stop()
        await this._scheduler.stop()
        await this._runner.stop()
        this._control.clear()
        this._toolDispose?.()
        this._toolDispose = undefined
        this._finishDispose?.()
        this._finishDispose = undefined
        this._promptDispose?.()
        this._promptDispose = undefined
    }

    async create(actor: TriggerActor, input: TriggerCreateInput) {
        const parsed = createTriggerCreateInputSchema(this._registry).parse(
            input
        )
        this._checkTarget(actor, parsed.target)
        const now = new Date()
        const condition = this._planner.validate(parsed.condition)
        const draft = {
            ...parsed,
            condition,
            ownerKey: actor.key,
            id: 0,
            state: {
                status: 'waiting' as const,
                runCount: 0
            },
            createdAt: now,
            updatedAt: now
        } satisfies TriggerTask
        const task = await this._store.create({
            ...parsed,
            condition,
            ownerKey: actor.key,
            state: this._planner.initialState(draft, now)
        })
        await this._afterChange()
        return task
    }

    async update(actor: TriggerActor, id: number, input: TriggerUpdateInput) {
        const current = await this._getOwned(actor, id)
        const parsed = createTriggerUpdateInputSchema(this._registry).parse(
            input
        )
        this._checkTarget(actor, parsed.target)
        const now = new Date()
        const condition = this._planner.validate(parsed.condition)
        const draft = {
            ...current,
            ...parsed,
            condition,
            updatedAt: now
        }
        let state: TriggerTask['state'] = {
            ...current.state,
            status: 'paused',
            nextRunAt: null,
            suppressedUntil: null
        }
        if (parsed.enabled) {
            state = {
                ...this._planner.initialState(draft, now),
                runCount: current.state.runCount,
                lastRunAt: current.state.lastRunAt,
                lastDecision: current.state.lastDecision,
                lastError: current.state.lastError
            }
        }
        const task = await this._store.update(id, {
            ...parsed,
            condition,
            state
        })
        await this._afterChange()
        return task
    }

    async remove(actor: TriggerActor, id: number) {
        await this._getOwned(actor, id)
        await this._runner.abortTask(id)
        await this._store.remove(id)
        await this._afterChange()
    }

    async get(actor: TriggerActor, id: number) {
        return await this._getOwned(actor, id)
    }

    async list(actor: TriggerActor, filter?: TriggerListFilter) {
        return await this._store.list({
            ...filter,
            ownerKey: actor.authority >= 3 ? undefined : actor.key
        })
    }

    async listRuns(actor: TriggerActor, id: number, limit = 20) {
        await this._getOwned(actor, id)
        return await this._store.listRuns(id, Math.min(Math.max(limit, 1), 100))
    }

    async setEnabled(actor: TriggerActor, id: number, enabled: boolean) {
        const current = await this._getOwned(actor, id)
        if (current.enabled === enabled) return current

        const now = new Date()
        let state: TriggerTask['state'] = {
            ...current.state,
            status: 'paused',
            nextRunAt: null,
            suppressedUntil: null
        }
        if (enabled) {
            state = {
                ...this._planner.initialState(
                    { ...current, enabled, updatedAt: now },
                    now
                ),
                runCount: current.state.runCount,
                lastRunAt: current.state.lastRunAt,
                lastDecision: current.state.lastDecision,
                lastError: current.state.lastError
            }
        }
        const task = await this._store.update(id, {
            enabled,
            state
        })
        await this._afterChange()
        return task
    }

    async resume(actor: TriggerActor, id: number) {
        const current = await this._getOwned(actor, id)
        const now = new Date()
        const task = await this._store.update(id, {
            enabled: true,
            state: {
                ...this._planner.initialState(
                    { ...current, enabled: true, updatedAt: now },
                    now
                ),
                runCount: current.state.runCount,
                lastRunAt: current.state.lastRunAt,
                lastDecision: current.state.lastDecision,
                lastError: current.state.lastError
            }
        })
        await this._afterChange()
        return task
    }

    async pauseUntil(actor: TriggerActor, id: number, at: string) {
        const current = await this._getOwned(actor, id)
        finishTriggerRunSchema.parse({
            decision: 'pause_until',
            at
        })
        const date = new Date(at)
        if (date.valueOf() <= Date.now()) {
            throw new ChatLunaError(
                ChatLunaErrorCode.TRIGGER_INVALID_INPUT,
                new Error('pause_until requires a valid future ISO timestamp')
            )
        }

        const task = await this._store.update(id, {
            enabled: true,
            state: {
                ...current.state,
                status: 'paused',
                nextRunAt: date.toISOString(),
                suppressedUntil: date.toISOString()
            }
        })
        await this._afterChange()
        return task
    }

    async fire(actor: TriggerActor, id: number): Promise<TriggerRun> {
        await this._getOwned(actor, id)
        return await this._runner.run(id, 'manual')
    }

    async wakeup(actor: TriggerActor, input: TriggerWakeupInput) {
        const parsed = triggerWakeupInputSchema.parse(input)
        this._checkTarget(actor, parsed.target)
        const target = parsed.target
        const destination = target.destination
        return await this.ctx.chatluna.invoke({
            routing: {
                platform: target.bot.platform,
                selfId: target.bot.selfId,
                userId: target.principalId,
                guildId:
                    destination.type === 'channel'
                        ? destination.guildId
                        : undefined,
                channelId:
                    destination.type === 'channel'
                        ? destination.channelId
                        : destination.userId,
                isDirect: destination.type === 'direct'
            },
            message: parsed.execution.prompt,
            model:
                parsed.execution.model.type === 'fixed'
                    ? parsed.execution.model.model
                    : undefined,
            preset: parsed.execution.preset ?? undefined,
            conversation: toInvokeConversation(
                parsed.execution.conversation,
                `trigger:wakeup:${actor.key}`
            ),
            tools:
                parsed.execution.tools.type === 'allow'
                    ? {
                          mode: 'allow',
                          allow: parsed.execution.tools.names,
                          deny: []
                      }
                    : { mode: 'allow', allow: [], deny: [] },
            timeout: parsed.execution.timeoutSeconds * 1000,
            delivery: target.delivery,
            source: { kind: 'trigger-wakeup' }
        })
    }

    async previewCondition(condition: TriggerCondition, count = 5) {
        return this._planner.preview(
            this._planner.validate(condition),
            Math.min(Math.max(count, 1), 20),
            new Date()
        )
    }

    getStatus(): TriggerStatus {
        return this._status
    }

    listRoutingChoices() {
        const seen = new Set<string>()
        return Object.values(this.ctx.bots)
            .filter((bot) => {
                const key = `${bot.platform}:${bot.selfId}`
                if (seen.has(key)) return false
                seen.add(key)
                return true
            })
            .map((bot) => ({
                label: bot.sid,
                platform: bot.platform,
                selfId: bot.selfId
            }))
            .sort((a, b) => a.label.localeCompare(b.label))
    }

    private async _onProviderRemoved(id: string) {
        if (this.ctx.database == null) {
            await this._afterChange()
            return
        }
        const tasks = await this._store.list()
        for (const task of tasks) {
            if (
                task.condition.type !== 'extension' ||
                task.condition.provider !== id
            ) {
                continue
            }
            await this._runner.abortTask(task.id)
            await this._store.update(task.id, {
                state: {
                    ...task.state,
                    status: 'error',
                    nextRunAt: null,
                    lastError: `Unknown trigger provider: ${id}`
                }
            })
        }
        await this._afterChange()
    }

    private async _reconcileStale() {
        await this._store.failRunningRuns('Interrupted by service restart')
        const running = await this._store.listRunning()
        for (const task of running) {
            const now = new Date()
            const cursor = gateCursor(task.state.cursor)
            if (isEventCondition(task.condition, this._registry)) {
                await this._store.update(task.id, {
                    state: {
                        ...task.state,
                        status: 'waiting',
                        nextRunAt: null,
                        cursor,
                        lastError: 'Interrupted by service restart'
                    }
                })
                continue
            }
            try {
                const plan = this._planner.next(task, now, { misfire: true })
                await this._store.update(task.id, {
                    state: {
                        ...task.state,
                        status: plan.status,
                        nextRunAt: plan.nextRunAt?.toISOString() ?? null,
                        suppressedUntil:
                            plan.suppressedUntil?.toISOString() ?? null,
                        periodKey: plan.periodKey ?? null,
                        occurrenceKey: plan.occurrenceKey ?? null,
                        cursor,
                        lastError: 'Interrupted by service restart'
                    }
                })
            } catch (err) {
                await this._store.update(task.id, {
                    state: {
                        ...task.state,
                        status: 'error',
                        nextRunAt: null,
                        cursor,
                        lastError:
                            err instanceof Error
                                ? err.message
                                : 'Interrupted by service restart'
                    }
                })
            }
        }
    }

    private async _getOwned(actor: TriggerActor, id: number) {
        const task = await this._store.get(id)
        if (!task) {
            throw new ChatLunaError(
                ChatLunaErrorCode.TRIGGER_NOT_FOUND,
                new Error(`Trigger task not found: ${id}`)
            )
        }
        if (actor.authority < 3 && task.ownerKey !== actor.key) {
            throw new ChatLunaError(
                ChatLunaErrorCode.TRIGGER_FORBIDDEN,
                new Error('You do not have permission to manage this trigger')
            )
        }
        return task
    }

    private _checkTarget(actor: TriggerActor, target: TriggerTask['target']) {
        if (actor.authority >= 3) return
        if (target.principalId !== actor.userId) {
            throw new ChatLunaError(
                ChatLunaErrorCode.TRIGGER_FORBIDDEN,
                new Error('Trigger principalId must match the current user')
            )
        }

        const session = actor.session
        if (!session) {
            throw new ChatLunaError(
                ChatLunaErrorCode.TRIGGER_FORBIDDEN,
                new Error('A session is required to create this trigger')
            )
        }
        if (
            target.bot.platform !== session.platform ||
            target.bot.selfId !== session.selfId
        ) {
            throw new ChatLunaError(
                ChatLunaErrorCode.TRIGGER_FORBIDDEN,
                new Error('Trigger bot must match the current route')
            )
        }

        if (session.isDirect) {
            if (
                target.destination.type !== 'direct' ||
                target.destination.userId !== session.userId
            ) {
                throw new ChatLunaError(
                    ChatLunaErrorCode.TRIGGER_FORBIDDEN,
                    new Error(
                        'Trigger destination must match the current route'
                    )
                )
            }
            return
        }

        if (
            target.destination.type !== 'channel' ||
            target.destination.channelId !== session.channelId ||
            target.destination.guildId !== session.guildId
        ) {
            throw new ChatLunaError(
                ChatLunaErrorCode.TRIGGER_FORBIDDEN,
                new Error('Trigger destination must match the current route')
            )
        }
    }

    private async _afterChange() {
        await this._scheduler.refresh()
        await this._refreshStatus()
        try {
            await this.ctx.chatluna_agent?.refreshConsoleData()
        } catch (err) {
            logger.error(err)
        }
    }

    private async _refreshStatus() {
        const tasks = await this._store.list()
        this._status = {
            total: tasks.length,
            enabled: tasks.filter((task) => task.enabled).length,
            waiting: tasks.filter((task) => task.state.status === 'waiting')
                .length,
            running: tasks.filter((task) => task.state.status === 'running')
                .length,
            paused: tasks.filter((task) => task.state.status === 'paused')
                .length,
            error: tasks.filter((task) => task.state.status === 'error').length
        }
    }
}
