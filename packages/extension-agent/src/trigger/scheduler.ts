import { Context } from 'koishi'
import { logger } from '..'
import type { TriggerTask } from '../types'

const MAX_DELAY = 2_147_483_647

export class ChatLunaAgentTriggerScheduler {
    private _timers = new Map<number, () => void>()

    constructor(
        private readonly ctx: Context,
        private readonly hooks: {
            list: () => Promise<TriggerTask[]>
            get: (id: number) => Promise<TriggerTask | undefined>
            update: (
                id: number,
                patch: Partial<TriggerTask>
            ) => Promise<TriggerTask>
            fire: (id: number) => Promise<void>
        }
    ) {}

    async start() {
        const tasks = await this.hooks.list()
        for (const task of tasks) {
            this.sync(task)
        }
    }

    stop() {
        for (const dispose of this._timers.values()) {
            dispose()
        }

        this._timers.clear()
    }

    sync(task: TriggerTask) {
        this.remove(task.id)

        if (!task.enabled || task.nextFireAt == null) return

        let active = true
        let dispose = () => {}
        const run = async () => {
            this._timers.delete(task.id)
            try {
                const latest = await this.hooks.get(task.id)
                if (
                    latest == null ||
                    !latest.enabled ||
                    latest.nextFireAt == null
                ) {
                    return
                }

                await this.hooks.fire(task.id)
            } catch (err) {
                logger.warn(err)
                const latest = await this.hooks.get(task.id)
                if (
                    latest != null &&
                    latest.enabled &&
                    latest.nextFireAt != null &&
                    latest.nextFireAt.valueOf() > Date.now()
                ) {
                    this.sync(latest)
                    return
                }

                if (latest != null) {
                    await this.hooks.update(task.id, {
                        enabled: false,
                        nextFireAt: null,
                        lastError:
                            err instanceof Error ? err.message : String(err)
                    })
                }
            }
        }
        const schedule = () => {
            if (!active) return

            const delay = Math.max(task.nextFireAt.valueOf() - Date.now(), 0)
            dispose = this.ctx.setTimeout(
                delay > MAX_DELAY ? schedule : run,
                Math.min(delay, MAX_DELAY)
            )
        }
        const cancel = () => {
            active = false
            dispose()
        }

        schedule()
        this._timers.set(task.id, cancel)
    }

    remove(id: number) {
        this._timers.get(id)?.()
        this._timers.delete(id)
    }
}
