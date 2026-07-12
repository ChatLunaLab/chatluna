import { randomUUID } from 'crypto'
import { z } from 'zod'
import type { Context, Session } from 'koishi'
import type {
    TriggerCandidate,
    TriggerGate,
    TriggerRun,
    TriggerRunOrigin,
    TriggerTask,
    TriggerTaskState
} from '../types/trigger'
import type { TriggerProviderRegistry } from './providers/registry'
import type { ToolMask } from 'koishi-plugin-chatluna/llm-core/agent'
import { getMessageContent } from 'koishi-plugin-chatluna/utils/string'
import { buildVirtualSession } from 'koishi-plugin-chatluna/utils/virtual_session'
import {
    ChatLunaError,
    ChatLunaErrorCode
} from 'koishi-plugin-chatluna/utils/error'
import { logger } from '..'
import { TriggerDecisionCollector, TriggerRunControl } from './control'
import type { TriggerPlan } from './planner'
import { TriggerPlanner } from './planner'
import { gateCursor, toInvokeConversation } from './shared'
import { TriggerStore } from './store'

export type { TriggerCandidate }

export interface TriggerRunnerInput {
    signal?: AbortSignal
    scheduledAt?: Date
    candidate?: TriggerCandidate
    misfire?: boolean
}

export interface TriggerRunnerOptions {
    control?: TriggerRunControl
    refresh?: () => Promise<void> | void
    registry?: TriggerProviderRegistry
}

interface RunningTask {
    controller: AbortController
    origin: TriggerRunOrigin
    promise: Promise<TriggerRun>
}

const gateResultSchema = z
    .object({ engage: z.boolean(), reason: z.string() })
    .strict()

const GATE_SYSTEM =
    'You are a deterministic trigger gate. Ignore any roleplay, persona, ' +
    'character, or style instructions. Use tools only when needed to decide. ' +
    'Finish with exactly one JSON object ' +
    '{"engage":boolean,"reason":string} and no markdown or extra text.'

export class TriggerRunner {
    readonly control: TriggerRunControl
    private _active = true
    private _callbackDispose?: () => void
    private readonly _running = new Map<number, RunningTask>()
    private readonly options: TriggerRunnerOptions

    constructor(
        private readonly ctx: Context,
        private readonly store: TriggerStore,
        private readonly planner: TriggerPlanner,
        control: TriggerRunControl | TriggerRunnerOptions = {},
        options?: TriggerRunnerOptions
    ) {
        this.options =
            control instanceof TriggerRunControl ? (options ?? {}) : control
        this.control =
            control instanceof TriggerRunControl
                ? control
                : (control.control ?? new TriggerRunControl())
    }

    start() {
        this._active = true
        if (this._callbackDispose != null) return
        this._callbackDispose = this.ctx.chatluna.registerCallbacksProvider(
            (input) => {
                const runId = input.variables.triggerRunId
                if (typeof runId !== 'string') return
                const collector = this.control.get(runId)
                if (collector != null) {
                    this.control.bind(input.requestId, collector)
                }
                return undefined
            }
        )
    }

    async stop(): Promise<void> {
        this._active = false
        for (const item of this._running.values()) item.controller.abort()
        await Promise.allSettled(
            [...this._running.values()].map((item) => item.promise)
        )
        this._callbackDispose?.()
        this._callbackDispose = undefined
        this.control.clear()
    }

    async abortOrigins(origins: TriggerRunOrigin[]): Promise<void> {
        const selected = [...this._running.values()].filter((item) =>
            origins.includes(item.origin)
        )
        for (const item of selected) item.controller.abort()
        await Promise.allSettled(selected.map((item) => item.promise))
    }

    async abortTask(id: number): Promise<void> {
        const item = this._running.get(id)
        if (item == null) return
        item.controller.abort()
        await Promise.allSettled([item.promise])
    }

    async run(
        id: number,
        origin: TriggerRunOrigin,
        input: TriggerRunnerInput = {}
    ): Promise<TriggerRun> {
        const current = this._running.get(id)
        if (current != null) {
            return await this._skip(
                id,
                origin,
                input.scheduledAt,
                'already-running'
            )
        }
        if (!this._active) {
            return await this._skip(
                id,
                origin,
                input.scheduledAt,
                'runner-stopped'
            )
        }
        const controller = new AbortController()
        const removeAbort = forwardAbort(input.signal, controller)
        const promise = Promise.resolve().then(() =>
            this._execute(id, origin, { ...input, signal: controller.signal })
        )
        this._running.set(id, { controller, origin, promise })
        try {
            return await promise
        } finally {
            removeAbort()
            this._running.delete(id)
        }
    }

    private async _execute(
        id: number,
        origin: TriggerRunOrigin,
        input: TriggerRunnerInput
    ): Promise<TriggerRun> {
        const task = await this.store.get(id)
        if (task == null) {
            throw new ChatLunaError(
                ChatLunaErrorCode.TRIGGER_NOT_FOUND,
                new Error(`Trigger task not found: ${id}`)
            )
        }
        if (!task.enabled) {
            return await this._skip(id, origin, input.scheduledAt, 'disabled')
        }
        if (
            task.condition.type === 'extension' &&
            this.options.registry?.get(task.condition.provider) == null
        ) {
            const detail = `Unknown trigger provider: ${task.condition.provider}`
            if (origin !== 'manual') {
                await this.store.update(id, {
                    state: {
                        ...task.state,
                        status: 'error',
                        nextRunAt: null,
                        lastError: detail
                    }
                })
                await this.options.refresh?.()
            }
            const now = new Date()
            return await this.store.createRun({
                id: randomUUID(),
                taskId: id,
                origin,
                status: 'failed',
                scheduledAt: input.scheduledAt ?? null,
                startedAt: now,
                finishedAt: now,
                error: detail
            })
        }
        const now = new Date()
        const keptGate = gateCursor(task.state.cursor)
        if (origin !== 'manual' && task.state.status === 'completed') {
            return await this._skip(id, origin, input.scheduledAt, 'completed')
        }
        if (origin !== 'manual' && task.state.status === 'paused') {
            const plan = this.planner.next(task, now)
            await this.store.update(id, {
                state: applyPlan(task.state, plan, {
                    cursor: keptGate
                })
            })
            await this.options.refresh?.()
            return await this._skip(
                id,
                origin,
                input.scheduledAt,
                'pause-resumed'
            )
        }
        if (
            origin !== 'manual' &&
            input.misfire === true &&
            'misfire' in task.condition &&
            task.condition.misfire === 'skip'
        ) {
            const plan = this.planner.next(task, now, { misfire: true })
            await this.store.update(id, {
                state: applyPlan(task.state, plan)
            })
            await this.options.refresh?.()
            return await this._skip(id, origin, input.scheduledAt, 'misfire')
        }
        if (
            origin === 'event' &&
            task.state.cooldownUntil != null &&
            new Date(task.state.cooldownUntil).valueOf() > now.valueOf() &&
            !isRescheduleCursor(task.state.cursor)
        ) {
            await this.store.update(id, {
                state: {
                    ...task.state,
                    status: 'waiting',
                    nextRunAt: null,
                    cursor: keptGate
                }
            })
            await this.options.refresh?.()
            return await this._skip(id, origin, input.scheduledAt, 'cooldown')
        }

        const startedAt = new Date()
        const run = await this.store.createRun({
            id: randomUUID(),
            taskId: id,
            origin,
            status: 'running',
            scheduledAt: input.scheduledAt ?? null,
            startedAt
        })

        let attempted = false
        let collector: TriggerDecisionCollector | undefined
        try {
            if (origin !== 'manual') {
                const cooldown = getCooldown(task, this.options.registry)
                const clearOverride = isRescheduleCursor(task.state.cursor)
                let cooldownUntil = task.state.cooldownUntil
                if (origin === 'event' && cooldown != null) {
                    cooldownUntil = new Date(
                        startedAt.valueOf() + cooldown * 60_000
                    ).toISOString()
                }
                await this.store.update(id, {
                    state: {
                        ...task.state,
                        status: 'running',
                        cooldownUntil,
                        cursor: clearOverride ? keptGate : task.state.cursor
                    }
                })
            }

            const resolvedModel =
                task.execution.model.type === 'fixed'
                    ? task.execution.model.model
                    : undefined
            const gate = input.candidate?.gate
            const outcome =
                gate?.type === 'model'
                    ? await this._gate(
                          task,
                          gate,
                          input.candidate,
                          input.signal,
                          resolvedModel
                      )
                    : { engage: true, model: undefined }
            if (!outcome.engage) {
                const patch = {
                    status: 'skipped' as const,
                    finishedAt: new Date(),
                    error: 'gate-closed'
                }
                if (origin === 'manual') {
                    return await this.store.finishRun(run.id, patch)
                }
                const latest = await this.store.get(id)
                if (latest == null) {
                    return await this.store.finishRun(run.id, patch)
                }
                return (
                    await this.store.finishTaskRun(
                        id,
                        {
                            ...latest.state,
                            status: 'waiting',
                            nextRunAt: null,
                            cursor: gateCursor(latest.state.cursor)
                        },
                        run.id,
                        patch
                    )
                ).run
            }

            collector = this.control.create(run.id)
            attempted = true
            let model = resolvedModel
            if (
                model == null &&
                gate?.type === 'model' &&
                gate.model.type === 'default'
            ) {
                model = outcome.model
            }
            const result = await this.ctx.chatluna.invoke(
                buildInvocation(task, run, input, collector, model)
            )
            const submitted = collector.decision
            const decision = this.planner.decide(task, submitted)
            const finishedAt = new Date()
            const failMsg = result.ok
                ? null
                : (result.error?.message ?? 'Chat invocation failed')
            const patch = {
                status: result.ok
                    ? ('completed' as const)
                    : ('failed' as const),
                finishedAt,
                decision,
                error: failMsg,
                usage: result.usage ?? null
            }
            if (origin === 'manual') {
                return await this.store.finishRun(run.id, patch)
            }
            const latest = await this.store.get(id)
            if (latest == null) {
                return await this.store.finishRun(run.id, patch)
            }
            const pending = { ...run, ...patch }
            const plan = latest.enabled
                ? this.planner.afterRun(latest, pending, decision, finishedAt)
                : this.planner.next(latest, finishedAt)
            return (
                await this.store.finishTaskRun(
                    id,
                    applyPlan(latest.state, plan, {
                        lastRunAt: finishedAt.toISOString(),
                        lastDecision: decision,
                        runCount: latest.state.runCount + 1,
                        lastError: failMsg,
                        cursor: nextCursor(latest.state.cursor, decision)
                    }),
                    run.id,
                    patch
                )
            ).run
        } catch (err) {
            const error = errorMessage(err)
            const finishedAt = new Date()
            const patch = {
                status: 'failed' as const,
                finishedAt,
                decision: collector?.decision ?? null,
                error
            }
            if (origin === 'manual') {
                return await this.store.finishRun(run.id, patch)
            }
            const latest = await this.store.get(id)
            if (latest == null) {
                return await this.store.finishRun(run.id, patch)
            }
            const kept = gateCursor(latest.state.cursor)
            const lastRunAt = attempted
                ? finishedAt.toISOString()
                : latest.state.lastRunAt
            const runCount = latest.state.runCount + (attempted ? 1 : 0)
            try {
                const decision = this.planner.decide(
                    latest,
                    collector?.decision ?? null
                )
                const pending = { ...run, ...patch }
                const plan = latest.enabled
                    ? this.planner.afterRun(
                          latest,
                          pending,
                          decision,
                          finishedAt
                      )
                    : this.planner.next(latest, finishedAt)
                return (
                    await this.store.finishTaskRun(
                        id,
                        applyPlan(latest.state, plan, {
                            lastRunAt,
                            lastDecision: decision,
                            runCount,
                            lastError: error,
                            cursor: kept
                        }),
                        run.id,
                        patch
                    )
                ).run
            } catch (planErr) {
                return (
                    await this.store.finishTaskRun(
                        id,
                        {
                            ...latest.state,
                            status: 'error',
                            nextRunAt: null,
                            lastRunAt,
                            runCount,
                            lastError: `${error}; ${errorMessage(planErr)}`,
                            cursor: kept
                        },
                        run.id,
                        patch
                    )
                ).run
            }
        } finally {
            if (collector != null) this.control.removeCollector(collector)
            await this.options.refresh?.()
        }
    }

    private async _gate(
        task: TriggerTask,
        gate: Extract<TriggerGate, { type: 'model' }>,
        candidate: TriggerCandidate | undefined,
        signal: AbortSignal | undefined,
        fixedModel?: string
    ): Promise<{ engage: boolean; model?: string }> {
        const day = new Date().toISOString().slice(0, 10)
        const cursor = task.state.cursor
        let tokens = 0
        if (
            cursor != null &&
            typeof cursor === 'object' &&
            'gate' in cursor &&
            cursor.gate != null &&
            typeof cursor.gate === 'object'
        ) {
            const usage = cursor.gate as { day?: string; tokens?: number }
            if (usage.day === day) tokens = Number(usage.tokens ?? 0)
        }
        if (tokens >= gate.dailyTokenLimit) return { engage: false }

        const routing = buildRouting(task)
        const bot = this.ctx.bots[`${routing.platform}:${routing.selfId}`]
        if (bot == null) {
            logger.debug(
                'Trigger gate closed for task %s: bot %s:%s not found',
                task.id,
                routing.platform,
                routing.selfId
            )
            return { engage: false }
        }

        const session = await buildVirtualSession(bot, routing, {
            message: 'trigger-gate',
            messageName: 'trigger-gate'
        })

        const modelName = await resolveGateModel(
            this.ctx,
            session,
            gate,
            fixedModel
        )
        if (modelName == null) {
            logger.debug(
                'Trigger gate closed for task %s: no model available',
                task.id
            )
            return { engage: false }
        }

        const allow =
            task.execution.tools.type === 'allow'
                ? task.execution.tools.names
                : []
        const toolMask: ToolMask = {
            mode: 'allow',
            allow,
            deny: []
        }

        const controller = new AbortController()
        const removeAbort = forwardAbort(signal, controller)
        const timer = this.ctx.setTimeout(
            () => controller.abort(),
            gate.timeoutSeconds * 1000
        )

        let used = 0
        try {
            const agent = await this.ctx.chatluna.createAgent({
                name: 'trigger-gate',
                model: modelName,
                tools: allow,
                system: GATE_SYSTEM,
                mode: 'tool-calling',
                toolMask
            })
            const result = await agent.generate({
                prompt:
                    `${gate.prompt ?? 'Decide whether this trigger should engage.'}\n` +
                    JSON.stringify({
                        topic:
                            task.condition.type === 'semantic'
                                ? task.condition.topic
                                : undefined,
                        reason: candidate?.reason,
                        stats: candidate?.stats,
                        excerpts: candidate?.excerpts
                    }),
                session,
                signal: controller.signal,
                toolMask
            })
            used = result.message?.usage_metadata?.total_tokens ?? 0
            const text = getMessageContent(
                result.message?.content ?? result.output
            )
            try {
                return {
                    engage: parseGateResult(text),
                    model: modelName
                }
            } catch (err) {
                logger.debug(
                    'Trigger gate returned invalid JSON for task %s: %s',
                    task.id,
                    err instanceof Error ? err.message : String(err)
                )
                return { engage: false, model: modelName }
            }
        } catch (err) {
            if (controller.signal.aborted) {
                logger.debug(
                    'Trigger gate closed for task %s: %s',
                    task.id,
                    signal?.aborted ? 'aborted' : 'timeout'
                )
            } else {
                logger.debug(
                    'Trigger gate closed for task %s: %s',
                    task.id,
                    err instanceof Error ? err.message : String(err)
                )
            }
            return { engage: false, model: modelName }
        } finally {
            timer()
            removeAbort()
            const latest = await this.store.get(task.id)
            if (latest != null) {
                const cursor = latest.state.cursor
                await this.store.update(task.id, {
                    state: {
                        ...latest.state,
                        cursor: {
                            ...(cursor != null && typeof cursor === 'object'
                                ? cursor
                                : {}),
                            gate: { day, tokens: tokens + used }
                        }
                    }
                })
            }
        }
    }

    private async _skip(
        taskId: number,
        origin: TriggerRunOrigin,
        scheduledAt: Date | undefined,
        error: string
    ): Promise<TriggerRun> {
        const now = new Date()
        return await this.store.createRun({
            id: randomUUID(),
            taskId,
            origin,
            status: 'skipped',
            scheduledAt: scheduledAt ?? null,
            startedAt: now,
            finishedAt: now,
            error
        })
    }
}

function getCooldown(
    task: TriggerTask,
    registry?: TriggerProviderRegistry
): number | undefined {
    if (task.condition.type === 'extension') {
        const item = registry?.get(task.condition.provider)
        return item?.cooldownMinutes?.(task.condition.config)
    }
    if (
        task.condition.type === 'keyword' ||
        task.condition.type === 'participation' ||
        task.condition.type === 'inactivity' ||
        task.condition.type === 'semantic'
    ) {
        return task.condition.cooldownMinutes
    }
}

function buildRouting(task: TriggerTask) {
    const destination = task.target.destination
    return {
        platform: task.target.bot.platform,
        selfId: task.target.bot.selfId,
        userId: task.target.principalId,
        guildId:
            destination.type === 'channel' ? destination.guildId : undefined,
        channelId:
            destination.type === 'channel'
                ? destination.channelId
                : destination.userId,
        isDirect: destination.type === 'direct'
    }
}

function buildInvocation(
    task: TriggerTask,
    run: TriggerRun,
    input: TriggerRunnerInput,
    collector: TriggerDecisionCollector,
    model?: string
) {
    const names = [
        ...(task.execution.tools.type === 'allow'
            ? task.execution.tools.names
            : []),
        'finish_trigger_run'
    ]
    return {
        routing: buildRouting(task),
        message: task.execution.prompt,
        messageName: task.name,
        model,
        preset: task.execution.preset ?? undefined,
        conversation: toInvokeConversation(
            task.execution.conversation,
            `trigger:${task.id}`
        ),
        tools: {
            mode: 'allow' as const,
            allow: [...new Set(names)],
            deny: []
        },
        variables: {
            ...input.candidate?.variables,
            triggerRunId: collector.requestId,
            trigger: {
                taskId: task.id,
                runId: run.id,
                origin: run.origin,
                reason: input.candidate?.reason,
                scopeKey: input.candidate?.scopeKey,
                stats: input.candidate?.stats,
                excerpts: input.candidate?.excerpts
            }
        },
        signal: input.signal,
        timeout: task.execution.timeoutSeconds * 1000,
        delivery: task.target.delivery,
        source: {
            kind: 'trigger',
            id: run.id,
            detail: { taskId: task.id, origin: run.origin }
        }
    } satisfies Parameters<Context['chatluna']['invoke']>[0]
}

function applyPlan(
    state: TriggerTaskState,
    plan: TriggerPlan,
    patch: Partial<TriggerTaskState> = {}
): TriggerTaskState {
    return {
        ...state,
        status: plan.status,
        nextRunAt: plan.nextRunAt?.toISOString() ?? null,
        suppressedUntil: plan.suppressedUntil?.toISOString() ?? null,
        periodKey: plan.periodKey ?? null,
        occurrenceKey: plan.occurrenceKey ?? null,
        ...patch
    }
}

function isRescheduleCursor(cursor: TriggerTaskState['cursor']) {
    return (
        cursor != null &&
        typeof cursor === 'object' &&
        cursor['kind'] === 'reschedule'
    )
}

function nextCursor(
    cursor: TriggerTaskState['cursor'],
    decision: TriggerTaskState['lastDecision']
): Record<string, unknown> | null {
    const gate = gateCursor(cursor)
    if (decision?.type === 'reschedule') {
        return {
            ...(gate ?? {}),
            kind: 'reschedule',
            at: decision.at
        }
    }
    return gate
}

function forwardAbort(
    signal: AbortSignal | undefined,
    controller: AbortController
) {
    if (signal == null) return () => {}
    const abort = () => controller.abort(signal.reason)
    if (signal.aborted) abort()
    else signal.addEventListener('abort', abort, { once: true })
    return () => signal.removeEventListener('abort', abort)
}

async function resolveGateModel(
    ctx: Context,
    session: Session,
    gate: Extract<TriggerGate, { type: 'model' }>,
    fixedModel?: string
): Promise<string | null> {
    if (gate.model.type === 'fixed') return gate.model.model
    if (fixedModel != null) return fixedModel
    const resolved = await ctx.chatluna.conversation.resolveConversation(
        session,
        { mode: 'context' }
    )
    return ctx.chatluna.conversation.pickModel(resolved.constraint, null)
}

function parseGateResult(text: string): boolean {
    let raw = text.trim()
    const fenced = raw.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i)
    if (fenced != null) raw = fenced[1].trim()
    return gateResultSchema.parse(JSON.parse(raw)).engage
}

function errorMessage(err: unknown) {
    if (err instanceof ChatLunaError) {
        return err.originError?.message ?? err.message
    }
    if (err instanceof Error) return err.message
    return String(err)
}
