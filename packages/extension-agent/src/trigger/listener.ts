import { type Context, h, type Session } from 'koishi'
import type {
    TriggerProvider,
    TriggerProviderPassiveMatch,
    TriggerTask
} from '../types'

export class ChatLunaAgentTriggerListener {
    private readonly _bindings = new Map<string, { key: string; ts: number }>()

    private readonly _cooldown = new Map<number, number>()
    private readonly _dedup = new Map<string, number>()
    private readonly _pending = new Set<number>()
    private _dispose?: () => void
    private _bindingDispose?: () => void
    private _constraintDispose?: () => void

    constructor(
        private readonly ctx: Context,
        private readonly hooks: {
            list: (bindingKey: string) => Promise<TriggerTask[]>
            getProvider: (
                kind: string | null | undefined
            ) => TriggerProvider | undefined
            fire: (
                id: number,
                input: {
                    session: Session
                    message: TriggerTask['wakeupTemplate']['message']
                    messageName?: string
                    detail?: unknown
                }
            ) => Promise<{ ok: boolean; deferred?: unknown }>
        }
    ) {}

    start() {
        this._dispose?.()
        this._bindingDispose?.()
        this._constraintDispose?.()
        this._dispose = this.ctx.on(
            'chatluna/check-passive-trigger',
            async (session, content) => await this.handle(session, content)
        )
        this._bindingDispose = this.ctx.on(
            'chatluna/after-binding-update',
            async () => this.invalidateBindings()
        )
        this._constraintDispose = this.ctx.on(
            'chatluna/after-constraint-update',
            async () => this.invalidateBindings()
        )
    }

    stop() {
        this._dispose?.()
        this._dispose = undefined
        this._bindingDispose?.()
        this._bindingDispose = undefined
        this._constraintDispose?.()
        this._constraintDispose = undefined
        this._bindings.clear()
        this._cooldown.clear()
        this._dedup.clear()
        this._pending.clear()
    }

    async handle(session: Session, input?: string) {
        const content = input ?? h.select(session.elements, 'text').join('')
        const text = content.trim()
        const now = Date.now()
        this._compact(now)

        const key = `${session.uid}:${session.guildId ?? 'd'}:${session.channelId}`
        let entry = this._bindings.get(key)
        if (entry == null) {
            const bindingKey = (
                await this.ctx.chatluna.conversation.resolveConstraint(session)
            ).bindingKey
            entry = { key: bindingKey, ts: now }
        } else {
            entry.ts = now
        }
        this._bindings.set(key, entry)

        const tasks = (await this.hooks.list(entry.key)).filter(
            (task) => task.providerKind != null
        )
        if (tasks.length < 1) return false

        for (const task of tasks) {
            const provider = this.hooks.getProvider(task.providerKind)
            if (provider?.passive !== true || provider.match == null) continue

            const cooldownMs = (task.params?.cooldownMs as number) ?? 0
            const cooldownUntil = this._cooldown.get(task.id) ?? 0
            if (
                cooldownUntil > now ||
                (cooldownMs > 0 &&
                    task.lastFiredAt != null &&
                    now - task.lastFiredAt.valueOf() < cooldownMs)
            ) {
                continue
            }

            if (this._pending.has(task.id)) continue

            const dedupKey = `${task.id}:${session.messageId ?? `${session.userId}:${session.channelId ?? 'd'}:${text.slice(0, 32)}`}`
            const lastSeen = this._dedup.get(dedupKey) ?? 0
            if (lastSeen > now - 2000) continue

            let matched: TriggerProviderPassiveMatch | null
            try {
                matched = await provider.match({
                    session,
                    task,
                    content: text
                })
            } catch (err) {
                this.ctx.logger.warn(err)
                continue
            }
            if (matched == null) continue

            this._pending.add(task.id)
            this._dedup.set(dedupKey, now)
            ;(async () => {
                try {
                    const result = await this.hooks.fire(task.id, {
                        session,
                        message:
                            matched.message ??
                            task.wakeupTemplate.message ??
                            text,
                        messageName: matched.messageName ?? session.username,
                        detail: matched.detail
                    })
                    if (
                        cooldownMs > 0 &&
                        (result.ok || result.deferred != null)
                    ) {
                        this._cooldown.set(task.id, now + cooldownMs)
                    }
                } catch (err) {
                    if (cooldownMs > 0) {
                        this._cooldown.set(task.id, now + cooldownMs)
                    }
                    this.ctx.logger.warn(err)
                } finally {
                    this._pending.delete(task.id)
                }
            })()
            return true
        }

        return false
    }

    invalidateBindings() {
        this._bindings.clear()
    }

    private _compact(now: number) {
        for (const [id, value] of this._cooldown) {
            if (value <= now) this._cooldown.delete(id)
        }

        for (const [key, value] of this._dedup) {
            if (value <= now - 2000) this._dedup.delete(key)
        }

        for (const [key, entry] of this._bindings) {
            if (entry.ts <= now - 10 * 60 * 1000) {
                this._bindings.delete(key)
            }
        }

        if (this._bindings.size > 1024) {
            this._bindings.clear()
        }
    }
}
