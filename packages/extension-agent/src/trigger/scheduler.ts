import type { Context } from 'koishi'
import { logger } from '..'
import type { TriggerRunOrigin, TriggerTask } from '../types/trigger'
import type { TriggerProviderRegistry } from './providers/registry'
import type { TriggerRunner } from './runner'
import { isEventCondition } from './schema'
import type { TriggerStore } from './store'

const MAX_DELAY = 2_147_483_647
const DRAIN_CONCURRENCY = 3

export interface TriggerEventDeadlineOptions {
    signal: AbortSignal
    scheduledAt: Date
}

export type TriggerEventDeadlineHandler = (
    task: TriggerTask,
    options: TriggerEventDeadlineOptions
) => Promise<void>

export class TriggerScheduler {
    private _active = false
    private _cancel?: () => void
    private _event?: TriggerEventDeadlineHandler
    private _generation = 0
    private readonly _controllers = new Set<AbortController>()
    private readonly _runs = new Set<Promise<void>>()
    private _startup = true
    private _draining = false
    private _pendingRefresh = false

    constructor(
        private readonly ctx: Context,
        private readonly store: TriggerStore,
        private readonly runner: TriggerRunner,
        private readonly registry?: TriggerProviderRegistry
    ) {}

    async start(): Promise<void> {
        if (this._active) return
        this._active = true
        this._startup = true
        await this.refresh()
    }

    async stop(): Promise<void> {
        if (!this._active) return
        this._active = false
        this._generation++
        this._cancel?.()
        this._cancel = undefined
        this._event = undefined
        this._pendingRefresh = false
        for (const controller of this._controllers) controller.abort()
        await this.runner.abortOrigins(['schedule', 'event'])
        await Promise.all([...this._runs])
    }

    setEventHandler(handler?: TriggerEventDeadlineHandler) {
        this._event = handler
    }

    async refresh(): Promise<void> {
        if (!this._active) return
        if (this._draining) {
            this._pendingRefresh = true
            return
        }
        const generation = ++this._generation
        this._cancel?.()
        this._cancel = undefined
        const tasks = (await this.store.list({ enabled: true })).filter(
            (task) => task.state.nextRunAt != null
        )
        if (!this._active || generation !== this._generation) return
        tasks.sort((a, b) => {
            const delta =
                new Date(a.state.nextRunAt as string).valueOf() -
                new Date(b.state.nextRunAt as string).valueOf()
            return delta || a.id - b.id
        })
        const task = tasks[0]
        if (task == null) {
            this._startup = false
            return
        }
        const delay = Math.max(
            new Date(task.state.nextRunAt as string).valueOf() - Date.now(),
            0
        )
        if (delay > MAX_DELAY) {
            this._startup = false
            this._cancel = this.ctx.setTimeout(() => {
                this.refresh().catch((err) => logger.error(err))
            }, MAX_DELAY)
            return
        }
        // Do not arm repeated zero-delay timers for an overdue claimed task
        // while a drain is already in flight (guarded by _draining above).
        const startup = this._startup
        this._startup = false
        this._cancel = this.ctx.setTimeout(() => {
            const run = this._drain(startup)
            this._runs.add(run)
            run.finally(() => this._runs.delete(run)).catch((err) =>
                logger.error(err)
            )
        }, delay)
    }

    private async _drain(startup: boolean): Promise<void> {
        if (!this._active || this._draining) return
        this._draining = true
        this._cancel = undefined
        try {
            const now = new Date()
            const tasks = (await this.store.list({ enabled: true }))
                .filter(
                    (task) =>
                        task.state.nextRunAt != null &&
                        new Date(task.state.nextRunAt).valueOf() <=
                            now.valueOf()
                )
                .sort((a, b) => {
                    const delta =
                        new Date(a.state.nextRunAt as string).valueOf() -
                        new Date(b.state.nextRunAt as string).valueOf()
                    return delta || a.id - b.id
                })
            let cursor = 0
            const workers = Array.from(
                { length: Math.min(DRAIN_CONCURRENCY, tasks.length) },
                async () => {
                    while (this._active) {
                        const task = tasks[cursor++]
                        if (task == null) return
                        const controller = new AbortController()
                        this._controllers.add(controller)
                        const scheduledAt = new Date(
                            task.state.nextRunAt as string
                        )
                        try {
                            if (
                                task.condition.type === 'inactivity' &&
                                task.state.status !== 'paused' &&
                                task.state.cursor?.kind === 'inactivity' &&
                                this._event != null
                            ) {
                                await this._event(task, {
                                    signal: controller.signal,
                                    scheduledAt
                                })
                                continue
                            }
                            const origin: TriggerRunOrigin = isEventCondition(
                                task.condition,
                                this.registry
                            )
                                ? 'event'
                                : 'schedule'
                            await this.runner.run(task.id, origin, {
                                signal: controller.signal,
                                scheduledAt,
                                misfire: startup
                            })
                        } catch (err) {
                            logger.error(err)
                        } finally {
                            this._controllers.delete(controller)
                        }
                    }
                }
            )
            await Promise.all(workers)
        } finally {
            this._draining = false
            if (this._pendingRefresh) {
                this._pendingRefresh = false
            }
            await this.refresh()
        }
    }
}
