import { randomUUID } from 'crypto'
import { type Context, type Session, Universal } from 'koishi'
import {
    countMessageTokens,
    PromptContextRuntime
} from 'koishi-plugin-chatluna/llm-core/prompt'
import type { ToolMask } from 'koishi-plugin-chatluna/llm-core/agent'
import type { MessageContentComplex } from '@langchain/core/messages'
import {
    bindingKeyFromRouting,
    routingFromSession,
    type TriggerAdhocWakeupInput,
    type TriggerConfig,
    type TriggerCreateTaskInput,
    type TriggerProvider,
    type TriggerRoutingChoice,
    type TriggerStatus,
    type TriggerTask,
    type WakeupAction,
    type WakeupResult,
    type WakeupRouting,
    type WakeupScope,
    type WakeupTarget,
    type WakeupTemplate
} from '../types'
import { ChatLunaAgentTriggerExecutor } from '../trigger/executor'
import { ChatLunaAgentTriggerListener } from '../trigger/listener'
import { ChatLunaAgentTriggerProviderRegistry } from '../trigger/provider_registry'
import { ChatLunaAgentTriggerScheduler } from '../trigger/scheduler'
import { ChatLunaAgentTriggerTaskRegistry } from '../trigger/task_registry'
import { TriggerTool } from '../trigger/tool'
import {
    renderTriggerProviders,
    renderTriggerSelfControl
} from '../trigger/render'
import { activityTriggerProvider } from '../trigger/providers/activity'
import { cronTriggerProvider } from '../trigger/providers/cron'
import { keywordTriggerProvider } from '../trigger/providers/keyword'
import { onceTriggerProvider } from '../trigger/providers/once'
import { logger } from '..'

const RETRYABLE_FIRE_CODES = new Set([
    'conversation-unavailable',
    'no-routing',
    'invalid-binding-key'
])

/** Convenience options for {@link ChatLunaAgentTriggerService.wakeup}. */
export interface WakeupOptions extends WakeupTemplate {
    scope?: WakeupScope
    source?: WakeupAction['source']
    requestId?: string
    signal?: AbortSignal
}

interface DeferredWakeup {
    /** Pre-stripped action; never carries a live session. */
    action?: Partial<WakeupAction>
    mutateSchedule: boolean
    taskId?: number
}

interface RunningTask {
    taskId: number
    mutateSchedule: boolean
}

/**
 * Convenience input for `createTask` when the caller has a session.
 * Routing fields are derived from the session.
 */
export interface CreateTaskFromSessionOptions extends Omit<
    TriggerCreateTaskInput,
    | 'bindingKey'
    | 'platform'
    | 'selfId'
    | 'userId'
    | 'username'
    | 'guildId'
    | 'channelId'
    | 'isDirect'
    | 'createdBy'
> {
    bindingKey?: string
    scope?: WakeupScope
    createdBy?: string
}

export class ChatLunaAgentTriggerService {
    private readonly _deferred = new Map<string, Map<string, DeferredWakeup>>()
    private readonly _executor: ChatLunaAgentTriggerExecutor
    private readonly _listener: ChatLunaAgentTriggerListener
    private readonly _providers = new ChatLunaAgentTriggerProviderRegistry()
    private readonly _registry: ChatLunaAgentTriggerTaskRegistry
    private readonly _runningTasks = new Map<string, RunningTask>()
    private readonly _scheduler: ChatLunaAgentTriggerScheduler
    private _botDispose?: () => void
    private _toolDispose?: () => void
    private _promptDispose?: () => void
    private _status: TriggerStatus = {
        total: 0,
        enabled: 0,
        scheduled: 0,
        passive: 0
    }

    constructor(
        public readonly ctx: Context,
        public config: TriggerConfig
    ) {
        this._executor = new ChatLunaAgentTriggerExecutor(ctx)
        this._registry = new ChatLunaAgentTriggerTaskRegistry(ctx)
        this.registerProvider(cronTriggerProvider)
        this.registerProvider(onceTriggerProvider)
        this.registerProvider(activityTriggerProvider)
        this.registerProvider(keywordTriggerProvider)
        this._scheduler = new ChatLunaAgentTriggerScheduler(ctx, {
            list: async () =>
                (await this._registry.list({ enabled: true })).filter(
                    (task) =>
                        task.providerKind == null ||
                        this.isProviderEnabled(task.providerKind)
                ),
            get: async (id) => await this._registry.get(id),
            update: async (id, patch) => {
                const task = await this.updateTask(id, patch)
                this._scheduler.sync(task)
                return task
            },
            fire: async (id) => {
                await this._fireTask(id, undefined, true)
                await this._afterMutate()
            }
        })
        this._listener = new ChatLunaAgentTriggerListener(ctx, {
            list: async (bindingKey) =>
                await this._registry.listByBindingKey(bindingKey, true, true),
            getProvider: (kind) =>
                this.isProviderEnabled(kind)
                    ? this._providers.get(kind)
                    : undefined,
            fire: async (id, input) =>
                await this._fireTask(
                    id,
                    {
                        target: input.session,
                        message: input.message,
                        messageName: input.messageName,
                        source: {
                            kind: 'passive',
                            taskId: id,
                            providerKind:
                                (await this._registry.get(id))?.providerKind ??
                                undefined,
                            detail: input.detail
                        }
                    },
                    true
                )
        })
    }

    async start() {
        this._botDispose?.()
        this._botDispose = this.ctx.on('bot-status-updated', async (bot) => {
            if (bot.status !== Universal.Status.ONLINE) return
            await this._replayDeferred(bot.platform, bot.selfId)
        })
        this._toolDispose?.()
        this._toolDispose = this.ctx.chatluna.platform.registerTool('trigger', {
            description: new TriggerTool(this).description,
            selector: () => true,
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
        })
        await this._refreshStatus()
        await this._scheduler.start()
        this._listener.start()
        this._syncPrompt()
    }

    async stop() {
        this._botDispose?.()
        this._botDispose = undefined
        this._toolDispose?.()
        this._toolDispose = undefined
        this._promptDispose?.()
        this._promptDispose = undefined
        this._listener.stop()
        this._scheduler.stop()
        this._deferred.clear()
        this._status = { total: 0, enabled: 0, scheduled: 0, passive: 0 }
    }

    // ---- Public wakeup API -----------------------------------------------

    /**
     * Wake up an agent for the given target. The target may be a session
     * (most common; everything else is derived), a routing tuple, or a
     * `{ bindingKey }` reference.
     */
    async wakeup(
        target: WakeupTarget,
        opts: WakeupOptions = {}
    ): Promise<WakeupResult> {
        const action: WakeupAction = {
            ...opts,
            target,
            source: opts.source ?? { kind: 'adhoc' }
        }
        const result = await this._executor.wakeup(action)
        if (result.deferred != null) {
            this._queueDeferred(
                `wakeup:${result.requestId ?? Date.now()}`,
                result.deferred.pendingKey,
                {
                    action: this._stripReplayFields(action),
                    mutateSchedule: false
                }
            )
        }
        return result
    }

    /** Webui-only entry. Normalizes a flat record then forwards to wakeup. */
    async adhocWakeup(input: TriggerAdhocWakeupInput) {
        const { bindingKey, platform, selfId, userId, ...rest } = input
        if (
            bindingKey == null &&
            platform != null &&
            selfId != null &&
            userId != null
        ) {
            const routing: WakeupRouting = {
                platform,
                selfId,
                userId,
                guildId: input.guildId ?? undefined,
                channelId: input.channelId ?? undefined,
                isDirect: input.isDirect ?? false
            }
            return await this.wakeup(routing, rest)
        }
        if (bindingKey == null) {
            return await this._executor.wakeup({
                ...rest,
                source: { kind: 'adhoc' }
            })
        }
        return await this.wakeup({ bindingKey }, rest)
    }

    // ---- Task CRUD --------------------------------------------------------

    /**
     * Create a trigger task. The first argument is either a routing source
     * (most commonly a session) or a fully-specified `TriggerCreateTaskInput`
     * for transports that don't have a session (e.g. webui).
     */
    async createTask(
        sourceOrInput: Session | WakeupRouting | TriggerCreateTaskInput,
        opts?: CreateTaskFromSessionOptions
    ) {
        const input = await this._prepareTaskInput(
            this._deriveCreateInput(sourceOrInput, opts)
        )
        const task = await this._registry.create(input)
        await this._providers.get(task.providerKind)?.onTaskCreate?.({ task })
        this._scheduler.sync(task)
        await this._afterMutate()
        return task
    }

    async removeTask(id: number) {
        const task = await this._registry.get(id)
        this._deleteDeferred(id)
        this._scheduler.remove(id)
        await this._registry.remove(id)
        if (task != null) {
            await this._providers
                .get(task.providerKind)
                ?.onTaskRemove?.({ task })
        }
        await this._afterMutate()
    }

    async getTask(id: number) {
        return await this._registry.get(id)
    }

    async listTasks() {
        return await this._registry.list()
    }

    async fire(id: number, session?: Session) {
        const result = await this._fireTask(
            id,
            session ? { target: session } : undefined,
            false
        )
        await this._afterMutate()
        return result
    }

    async updateTask(id: number, patch: Partial<TriggerTask>) {
        const current = await this._registry.get(id)
        if (!current) {
            throw new Error(`Trigger task not found: ${id}`)
        }

        const task = await this._registry.update(
            id,
            await this._prepareTaskPatch(current, patch)
        )
        this._deleteDeferred(id)
        this._scheduler.sync(task)
        await this._afterMutate()
        return task
    }

    async setEnabled(id: number, enabled: boolean) {
        return await this.updateTask(id, { enabled })
    }

    getRunningTaskId(requestId: string | undefined) {
        if (requestId == null) return undefined
        return this._runningTasks.get(requestId)?.taskId
    }

    canMutateRunningTask(requestId: string | undefined) {
        if (requestId == null) return false
        return this._runningTasks.get(requestId)?.mutateSchedule === true
    }

    async snoozeTask(id: number, after: Date) {
        const task = await this._registry.get(id)
        if (task == null) {
            throw new Error(`Trigger task not found: ${id}`)
        }

        const next = (await this._providers
            .get(task.providerKind)
            ?.reschedule?.({
                task,
                after
            })) ?? { enabled: true, nextFireAt: after }
        const updated = await this._registry.update(id, next)
        this._deleteDeferred(id)
        this._scheduler.sync(updated)
        await this._afterMutate()
        return updated
    }

    getStatus(): TriggerStatus {
        return this._status
    }

    registerProvider(provider: TriggerProvider) {
        const dispose = this._providers.register(provider)
        this._syncPrompt()
        return () => {
            dispose()
            this._syncPrompt()
        }
    }

    listProviders() {
        return this._providers.listDescriptors().map((desc) => ({
            ...desc,
            enabled: this.isProviderEnabled(desc.kind)
        }))
    }

    getProviders() {
        return this._providers.list()
    }

    getEnabledProviders() {
        return this._providers
            .list()
            .filter((p) => this.isProviderEnabled(p.kind))
    }

    isProviderEnabled(kind: string) {
        return this.config.providers[kind]?.enabled !== false
    }

    async setProviderEnabled(kind: string, enabled: boolean) {
        if (this._providers.get(kind) == null) {
            throw new Error(`Unknown trigger provider: ${kind}`)
        }

        this.config.providers = {
            ...this.config.providers,
            [kind]: { enabled }
        }

        const tasks = await this._registry.list({ providerKind: kind })
        for (const task of tasks) {
            if (!enabled) {
                this._scheduler.remove(task.id)
            } else {
                this._scheduler.sync(task)
            }
        }

        this._syncPrompt()
    }

    listRoutingChoices(): TriggerRoutingChoice[] {
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

    // ---- Private helpers --------------------------------------------------

    private _deriveCreateInput(
        sourceOrInput: Session | WakeupRouting | TriggerCreateTaskInput,
        opts?: CreateTaskFromSessionOptions
    ): TriggerCreateTaskInput {
        if (
            opts == null &&
            'bindingKey' in sourceOrInput &&
            'platform' in sourceOrInput &&
            'selfId' in sourceOrInput &&
            'userId' in sourceOrInput &&
            'wakeupTemplate' in sourceOrInput &&
            'createdBy' in sourceOrInput
        ) {
            return sourceOrInput as TriggerCreateTaskInput
        }

        const o = opts ?? ({} as CreateTaskFromSessionOptions)
        const isSession = typeof (sourceOrInput as Session).bot === 'object'
        const routing = isSession
            ? routingFromSession(sourceOrInput as Session)
            : (sourceOrInput as WakeupRouting)

        return {
            ...o,
            ...routing,
            bindingKey:
                o.bindingKey ??
                bindingKeyFromRouting(routing, o.scope ?? 'personal'),
            createdBy:
                o.createdBy ??
                (isSession
                    ? (sourceOrInput as Session).userId
                    : routing.userId),
            wakeupTemplate: o.wakeupTemplate ?? {}
        } as TriggerCreateTaskInput
    }

    private _stripReplayFields(action: Partial<WakeupAction>) {
        const copy = { ...action }
        delete copy.signal
        delete copy.onReply

        const target = copy.target
        if (target == null) return copy
        if (
            typeof target === 'object' &&
            'bot' in target &&
            'platform' in target
        ) {
            return {
                ...copy,
                target: routingFromSession(target as Session)
            }
        }
        return copy
    }

    private async _afterMutate() {
        await this._refreshStatus()
        await this.ctx.chatluna_agent?.refreshConsoleData()
    }

    private async _fireTask(
        id: number,
        override?: Partial<WakeupAction>,
        mutateSchedule = true
    ) {
        const task = await this._registry.get(id)
        if (!task) {
            throw new Error(`Trigger task not found: ${id}`)
        }

        const overdue =
            mutateSchedule &&
            task.providerKind === 'cron' &&
            task.nextFireAt != null &&
            task.nextFireAt.valueOf() < Date.now()
        if (overdue && task.params?.missedRunPolicy !== 'fire_once') {
            const requestId = randomUUID()
            const provider = this._providers.get(task.providerKind)
            const result: WakeupResult = {
                ok: true,
                skipped: true,
                requestId,
                stats: { durationMs: 0 }
            }
            const next = await provider?.afterFire?.({
                task,
                currentDate: new Date()
            })
            const updated = await this._registry.update(id, {
                ...(next ?? {}),
                lastError: null
            })
            this._scheduler.sync(updated)
            await provider?.onTaskFire?.({ task: updated, result })
            return result
        }

        const taskRouting: WakeupRouting | undefined =
            task.platform && task.selfId && task.userId
                ? {
                      platform: task.platform,
                      selfId: task.selfId,
                      userId: task.userId,
                      username: task.username ?? undefined,
                      guildId: task.guildId ?? undefined,
                      channelId: task.channelId ?? undefined,
                      isDirect: task.isDirect
                  }
                : undefined
        const target =
            override?.target ??
            taskRouting ??
            (task.bindingKey != null
                ? { bindingKey: task.bindingKey }
                : undefined)
        const requestId = override?.requestId ?? randomUUID()
        const merged: WakeupAction = {
            ...task.wakeupTemplate,
            ...override,
            target,
            bindingKey: override?.bindingKey ?? task.bindingKey,
            requestId,
            conversationId: override?.conversationId ?? task.conversationId,
            presetLane: override?.presetLane ?? task.presetLane,
            source: override?.source ?? {
                kind: 'task',
                taskId: task.id,
                providerKind: task.providerKind ?? undefined
            }
        }

        if (merged.source.kind === 'task' && merged.source.taskId != null) {
            this._runningTasks.set(requestId, {
                taskId: merged.source.taskId,
                mutateSchedule
            })
        }

        const result = await this._executor.wakeup(merged).finally(() => {
            this._runningTasks.delete(requestId)
        })

        if (result.deferred != null) {
            this._queueDeferred(`task:${task.id}`, result.deferred.pendingKey, {
                action:
                    override == null
                        ? undefined
                        : this._stripReplayFields(override),
                mutateSchedule,
                taskId: task.id
            })
            await this._providers
                .get(task.providerKind)
                ?.onTaskFire?.({ task, result })
            return result
        }

        const provider = this._providers.get(task.providerKind)
        const firedAt = new Date()
        const latest = await this._registry.get(id)
        if (latest == null) return result

        const keepEnabled = RETRYABLE_FIRE_CODES.has(result.error?.code ?? '')
        const err = result.error?.message ?? 'Unknown error'

        if (latest.updatedAt.valueOf() > task.updatedAt.valueOf()) {
            const latestProvider = this._providers.get(latest.providerKind)
            const next =
                latestProvider?.afterFire != null
                    ? await latestProvider.afterFire({
                          task: latest,
                          firedAt,
                          currentDate: overdue ? firedAt : undefined
                      })
                    : keepEnabled
                      ? {
                            enabled: true,
                            nextFireAt:
                                latest.nextFireAt != null &&
                                latest.nextFireAt.valueOf() <= firedAt.valueOf()
                                    ? null
                                    : latest.nextFireAt
                        }
                      : result.ok && latestProvider?.passive === true
                        ? {
                              enabled: true,
                              nextFireAt: latest.nextFireAt
                          }
                        : { enabled: false, nextFireAt: null }
            const schedule = mutateSchedule && next != null ? next : {}
            const updated = await this._registry.update(id, {
                lastFiredAt: firedAt,
                fireCount: latest.fireCount + 1,
                ...(latest.wakeupTemplate.newConversation === true &&
                latest.conversationId == null &&
                result.ok &&
                result.conversation != null
                    ? { conversationId: result.conversation.id }
                    : {}),
                ...schedule,
                lastError: result.ok ? null : err
            })
            await latestProvider?.onTaskFire?.({ task: updated, result })
            if (mutateSchedule) {
                this._scheduler.sync(updated)
            }
            return result
        }

        const next =
            provider?.afterFire != null
                ? await provider.afterFire({
                      task,
                      firedAt,
                      currentDate: overdue ? firedAt : undefined
                  })
                : keepEnabled
                  ? {
                        enabled: true,
                        nextFireAt:
                            task.nextFireAt != null &&
                            task.nextFireAt.valueOf() <= firedAt.valueOf()
                                ? null
                                : task.nextFireAt
                    }
                  : result.ok && provider?.passive === true
                    ? {
                          enabled: true,
                          nextFireAt: task.nextFireAt
                      }
                    : { enabled: false, nextFireAt: null }
        const schedule = mutateSchedule && next != null ? next : {}
        const updated = await this._registry.update(id, {
            lastFiredAt: firedAt,
            fireCount: task.fireCount + 1,
            ...(task.wakeupTemplate.newConversation === true &&
            task.conversationId == null &&
            result.ok &&
            result.conversation != null
                ? { conversationId: result.conversation.id }
                : {}),
            ...schedule,
            lastError: result.ok ? null : err
        })
        await provider?.onTaskFire?.({ task: updated, result })
        if (mutateSchedule) {
            this._scheduler.sync(updated)
        }

        return result
    }

    private _queueDeferred(
        key: string,
        pendingKey: string,
        item: DeferredWakeup
    ) {
        const map = this._deferred.get(pendingKey) ?? new Map()
        map.set(key, item)
        this._deferred.set(pendingKey, map)
    }

    private async _replayDeferred(platform: string, selfId: string) {
        const key = `${platform}:${selfId}`
        const items = this._deferred.get(key)
        if (items == null || items.size < 1) return

        let changed = false
        this._deferred.delete(key)
        for (const item of items.values()) {
            try {
                if (item.taskId == null) {
                    if (
                        item.action?.message == null ||
                        item.action.source == null ||
                        item.action.target == null
                    ) {
                        logger.warn(
                            'Skip deferred wakeup replay because required action fields are missing.'
                        )
                        continue
                    }

                    const result = await this._executor.wakeup({
                        ...item.action,
                        target: item.action.target,
                        message: item.action.message,
                        source: item.action.source
                    })
                    if (result.deferred == null) {
                        changed = true
                    } else {
                        this._queueDeferred(
                            `wakeup:${result.requestId ?? Date.now()}`,
                            result.deferred.pendingKey,
                            item
                        )
                    }
                    continue
                }

                const task = await this._registry.get(item.taskId)
                if (task == null || !task.enabled) continue

                const result = await this._fireTask(
                    item.taskId,
                    item.action,
                    item.mutateSchedule
                )
                if (result.deferred == null) changed = true
            } catch (err) {
                logger.warn(err)
            }
        }

        if (changed) await this._afterMutate()
    }

    private _deleteDeferred(id: number) {
        for (const [key, items] of this._deferred) {
            items.delete(`task:${id}`)
            if (items.size < 1) this._deferred.delete(key)
        }
    }

    private _syncPrompt() {
        this._promptDispose?.()
        this._promptDispose = undefined

        if (this._providers.list().length < 1) return

        this._promptDispose = this.ctx.chatluna.contextManager.pipeline(
            'after_system_prompts',
            async (runtime: PromptContextRuntime, next) => {
                if (!runtime.configurable?.conversationId) return next()
                if (runtime.configurable?.subagentContext) return next()

                const mask = (runtime.configurable as { toolMask?: ToolMask })
                    ?.toolMask
                if (
                    mask != null &&
                    !this.ctx.chatluna.platform
                        .getFilteredTools(mask)
                        .includes('trigger')
                ) {
                    return next()
                }

                const providers = this.getEnabledProviders()
                if (providers.length < 1) return next()

                const msg = renderTriggerProviders(providers)
                runtime.result.push(msg)
                runtime.usedTokens += await countMessageTokens(
                    msg,
                    runtime.tokenCounter
                )

                const taskId = this.getRunningTaskId(
                    (
                        runtime.configurable as {
                            agentContext?: { requestId?: string }
                        }
                    ).agentContext?.requestId
                )
                const task =
                    taskId == null ? undefined : await this.getTask(taskId)
                if (task != null) {
                    const self = renderTriggerSelfControl(task, new Date())
                    runtime.result.push(self)
                    runtime.usedTokens += await countMessageTokens(
                        self,
                        runtime.tokenCounter
                    )
                }

                return next()
            },
            10
        )
    }

    private async _refreshStatus() {
        const tasks = await this._registry.list()
        let enabled = 0
        let scheduled = 0
        let passive = 0
        for (const task of tasks) {
            if (!task.enabled) continue
            if (
                task.providerKind != null &&
                !this.isProviderEnabled(task.providerKind)
            ) {
                continue
            }
            enabled++
            if (task.nextFireAt != null) scheduled++
            if (this._providers.get(task.providerKind)?.passive === true) {
                passive++
            }
        }
        this._status = { total: tasks.length, enabled, scheduled, passive }
    }

    private async _prepareTaskInput(input: TriggerCreateTaskInput) {
        if (
            input.providerKind != null &&
            !this.isProviderEnabled(input.providerKind)
        ) {
            throw new Error(
                `Trigger provider is disabled: ${input.providerKind}`
            )
        }

        const provider = this._providers.get(input.providerKind)
        if (provider == null && input.providerKind != null) {
            throw new Error(`Unknown trigger provider: ${input.providerKind}`)
        }

        if (provider?.needsMessage === true && !hasMessage(input)) {
            throw new Error('Trigger task message is required')
        }

        const patch = await provider?.prepare?.({ input })
        const merged: TriggerCreateTaskInput = {
            ...input,
            ...patch,
            wakeupTemplate: {
                newConversation: true,
                ...input.wakeupTemplate,
                ...(patch?.wakeupTemplate ?? {})
            },
            params: { ...(input.params ?? {}), ...(patch?.params ?? {}) }
        }

        if (provider == null) {
            if (!hasMessage(merged)) {
                throw new Error('Bare trigger task message is required')
            }
            if (merged.nextFireAt == null) {
                throw new Error('nextFireAt is required for bare trigger tasks')
            }
            if (Number.isNaN(new Date(merged.nextFireAt).valueOf())) {
                throw new Error('Invalid nextFireAt value')
            }
        }

        return merged
    }

    private async _prepareTaskPatch(
        task: TriggerTask,
        patch: Partial<TriggerTask>
    ) {
        const provider = this._providers.get(
            patch.providerKind ?? task.providerKind
        )
        if (provider == null) return patch

        const merged = {
            ...task,
            ...patch,
            params: { ...(task.params ?? {}), ...(patch.params ?? {}) },
            wakeupTemplate: {
                ...task.wakeupTemplate,
                ...(patch.wakeupTemplate ?? {})
            }
        }
        const next = await provider.prepare?.({ input: merged, task })

        const result: Partial<TriggerTask> = {
            ...patch,
            ...next,
            params: { ...(patch.params ?? {}), ...(next?.params ?? {}) }
        }

        if (patch.bindingKey != null && patch.bindingKey !== task.bindingKey) {
            result.conversationId = null
        } else if (patch.conversationId !== undefined) {
            result.conversationId = patch.conversationId
        }

        return result
    }
}

function hasMessage(input: {
    wakeupTemplate?: { message?: string | MessageContentComplex[] }
}) {
    const msg = input.wakeupTemplate?.message
    if (msg == null) return false
    return typeof msg !== 'string' || msg.trim().length > 0
}
