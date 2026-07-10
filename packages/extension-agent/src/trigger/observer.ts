import { type Context, h } from 'koishi'
import type { ChatLunaObservedMessage } from 'koishi-plugin-chatluna'
import { logger } from '..'
import type { TriggerTask } from '../types/trigger'
import type { TriggerCandidate, TriggerRunner } from './runner'
import type { TriggerEventDeadlineOptions, TriggerScheduler } from './scheduler'
import type { TriggerStore } from './store'

interface ObservedMessage {
    id: string
    at: number
    userId: string
    username?: string
    content: string
}

interface ObservedScopeState {
    messages: ObservedMessage[]
    lastMessageAt: number
}

const eventTypes = new Set([
    'keyword',
    'participation',
    'inactivity',
    'semantic'
])

export class TriggerObserver {
    private _active = false
    private _dispose?: () => void
    private _queue = Promise.resolve()
    private readonly _scopes = new Map<string, ObservedScopeState>()

    constructor(
        private readonly ctx: Context,
        private readonly store: TriggerStore,
        private readonly runner: TriggerRunner,
        private readonly scheduler: TriggerScheduler
    ) {}

    async start(): Promise<void> {
        if (this._active) return
        this._active = true
        this._dispose = this.ctx.on('chatluna/message-observed', (msg) => {
            this._queue = this._queue
                .then(async () => {
                    if (this._active) await this._observe(msg)
                })
                .catch((err) => logger.error(err))
        })
        this.scheduler.setEventHandler(
            async (task, options) => await this._deadline(task, options)
        )
    }

    async stop(): Promise<void> {
        if (!this._active) return
        this._active = false
        this._dispose?.()
        this._dispose = undefined
        this.scheduler.setEventHandler(undefined)
        await this._queue
        this._scopes.clear()
    }

    private async _observe(msg: ChatLunaObservedMessage): Promise<void> {
        const tasks = (await this.store.list({ enabled: true })).filter(
            (task) =>
                eventTypes.has(task.condition.type) &&
                (task.state.status === 'waiting' ||
                    task.state.status === 'running') &&
                task.target.bot.platform === msg.platform &&
                task.target.bot.selfId === msg.selfId
        )
        const groups = new Map<string, TriggerTask[]>()
        for (const task of tasks) {
            const key = getScopeKey(task, msg)
            if (key == null) continue
            const group = groups.get(key) ?? []
            group.push(task)
            groups.set(key, group)
        }
        if (groups.size < 1) return

        const content = h.select(msg.elements, 'text').join('').slice(0, 500)
        let refresh = false
        for (const [key, group] of groups) {
            const state = this._scopes.get(key) ?? {
                messages: [],
                lastMessageAt: msg.at.valueOf()
            }
            state.messages = state.messages
                .filter((item) => item.at >= msg.at.valueOf() - 30 * 60_000)
                .concat({
                    id: msg.id,
                    at: msg.at.valueOf(),
                    userId: msg.userId,
                    username: msg.username,
                    content
                })
                .slice(-100)
            state.lastMessageAt = msg.at.valueOf()
            this._scopes.set(key, state)

            for (const task of group) {
                if (task.state.status !== 'waiting') continue
                // Suppress normal observer candidates until reschedule override fires
                if (
                    task.state.cursor != null &&
                    typeof task.state.cursor === 'object' &&
                    task.state.cursor['kind'] === 'reschedule'
                ) {
                    continue
                }
                const candidate = this._candidate(task, key, state, content)
                if (task.condition.type === 'inactivity') {
                    const condition = task.condition
                    const active = state.messages.filter(
                        (item) =>
                            item.at >=
                            state.lastMessageAt -
                                condition.activeWithinMinutes * 60_000
                    )
                    if (active.length >= condition.minMessages) {
                        const deadline = new Date(
                            state.lastMessageAt +
                                condition.silentMinutes * 60_000
                        ).toISOString()
                        await this.store.update(task.id, {
                            state: {
                                ...task.state,
                                status: 'waiting',
                                nextRunAt: deadline,
                                cursor: {
                                    ...(task.state.cursor != null &&
                                    typeof task.state.cursor === 'object' &&
                                    'gate' in task.state.cursor
                                        ? { gate: task.state.cursor.gate }
                                        : {}),
                                    kind: 'inactivity',
                                    scopeKey: key,
                                    deadline
                                }
                            }
                        })
                        refresh = true
                    } else if (task.state.cursor?.kind === 'inactivity') {
                        await this.store.update(task.id, {
                            state: {
                                ...task.state,
                                status: 'waiting',
                                nextRunAt: null,
                                cursor:
                                    task.state.cursor != null &&
                                    typeof task.state.cursor === 'object' &&
                                    'gate' in task.state.cursor
                                        ? { gate: task.state.cursor.gate }
                                        : null
                            }
                        })
                        refresh = true
                    }
                    continue
                }
                if (candidate == null || inCooldown(task)) continue
                this.runner
                    .run(task.id, 'event', {
                        candidate,
                        scheduledAt: msg.at
                    })
                    .catch((err) => logger.error(err))
            }
        }
        if (refresh) await this.scheduler.refresh()
    }

    private _candidate(
        task: TriggerTask,
        key: string,
        state: ObservedScopeState,
        current: string
    ): TriggerCandidate | undefined {
        const condition = task.condition
        if (condition.type === 'keyword') {
            const content = condition.caseSensitive
                ? current
                : current.toLowerCase()
            const keyword = condition.keywords.find((item) =>
                content.includes(
                    condition.caseSensitive ? item : item.toLowerCase()
                )
            )
            if (keyword == null) return
            return {
                reason: `keyword:${keyword}`,
                scopeKey: key,
                excerpts: [current],
                stats: { messages: 1, users: 1 },
                variables: { triggerExcerpts: [current] }
            }
        }
        if (
            condition.type !== 'participation' &&
            condition.type !== 'semantic'
        ) {
            return
        }
        const messages = state.messages.filter(
            (item) =>
                item.at >=
                state.lastMessageAt - condition.withinMinutes * 60_000
        )
        const users = new Set(messages.map((item) => item.userId)).size
        if (messages.length < condition.minMessages) return
        if (condition.type === 'participation' && users < condition.minUsers) {
            return
        }
        const excerpts = formatExcerpts(messages)
        return {
            reason:
                condition.type === 'participation'
                    ? `participation:${messages.length} messages/${users} users/${condition.withinMinutes} minutes`
                    : `semantic:${condition.topic}`,
            scopeKey: key,
            excerpts,
            stats: {
                messages: messages.length,
                users,
                windowMinutes: condition.withinMinutes
            },
            variables: { triggerExcerpts: excerpts },
            gate: condition.gate
        }
    }

    private async _deadline(
        task: TriggerTask,
        options: TriggerEventDeadlineOptions
    ): Promise<void> {
        // Serialize on the same observer queue as observed messages
        await new Promise<void>((resolve, reject) => {
            this._queue = this._queue
                .then(async () => {
                    try {
                        await this._deadlineInner(task, options)
                        resolve()
                    } catch (err) {
                        reject(err)
                    }
                })
                .catch((err) => {
                    logger.error(err)
                    reject(err)
                })
        })
    }

    private async _deadlineInner(
        task: TriggerTask,
        options: TriggerEventDeadlineOptions
    ): Promise<void> {
        if (options.signal.aborted) return
        const latest = await this.store.get(task.id)
        if (
            latest == null ||
            latest.condition.type !== 'inactivity' ||
            latest.state.cursor?.kind !== 'inactivity'
        ) {
            return
        }
        const key = latest.state.cursor.scopeKey
        const deadline = latest.state.cursor.deadline
        const gateCursor =
            'gate' in latest.state.cursor
                ? { gate: latest.state.cursor.gate }
                : null
        if (typeof key !== 'string' || typeof deadline !== 'string') return
        if (
            latest.state.nextRunAt !== deadline ||
            new Date(deadline).valueOf() > Date.now()
        ) {
            return
        }
        const state = this._scopes.get(key)
        if (state == null) {
            await this.store.update(latest.id, {
                state: {
                    ...latest.state,
                    status: 'waiting',
                    nextRunAt: null,
                    cursor: gateCursor
                }
            })
            await this.scheduler.refresh()
            return
        }
        const condition = latest.condition
        const expected = state.lastMessageAt + condition.silentMinutes * 60_000
        const messages = state.messages.filter(
            (item) =>
                item.at >=
                    state.lastMessageAt -
                        condition.activeWithinMinutes * 60_000 &&
                item.at <= state.lastMessageAt
        )
        if (
            expected > Date.now() ||
            expected !== new Date(deadline).valueOf() ||
            messages.length < condition.minMessages
        ) {
            await this.store.update(latest.id, {
                state: {
                    ...latest.state,
                    nextRunAt:
                        expected > Date.now()
                            ? new Date(expected).toISOString()
                            : null,
                    cursor:
                        expected > Date.now()
                            ? {
                                  ...(gateCursor ?? {}),
                                  kind: 'inactivity',
                                  scopeKey: key,
                                  deadline: new Date(expected).toISOString()
                              }
                            : gateCursor
                }
            })
            await this.scheduler.refresh()
            return
        }
        const excerpts = formatExcerpts(messages)
        await this.runner.run(latest.id, 'event', {
            signal: options.signal,
            scheduledAt: options.scheduledAt,
            candidate: {
                reason: `inactivity:${messages.length} messages then ${condition.silentMinutes} silent minutes`,
                scopeKey: key,
                excerpts,
                stats: {
                    messages: messages.length,
                    users: new Set(messages.map((item) => item.userId)).size,
                    silentMinutes: condition.silentMinutes
                },
                variables: { triggerExcerpts: excerpts },
                gate: condition.gate
            }
        })
    }
}

function getScopeKey(
    task: TriggerTask,
    msg: ChatLunaObservedMessage
): string | undefined {
    if (
        task.target.observeScope === 'channel' &&
        task.target.destination.type === 'channel' &&
        task.target.destination.channelId === msg.channelId
    ) {
        return `channel:${msg.platform}:${msg.selfId}:${msg.channelId}`
    }
    if (
        task.target.observeScope === 'guild' &&
        task.target.destination.type === 'channel' &&
        task.target.destination.guildId != null &&
        task.target.destination.guildId === msg.guildId
    ) {
        return `guild:${msg.platform}:${msg.selfId}:${msg.guildId}`
    }
    if (
        task.target.observeScope === 'direct' &&
        task.target.destination.type === 'direct' &&
        msg.isDirect &&
        task.target.destination.userId === msg.userId
    ) {
        return `direct:${msg.platform}:${msg.selfId}:${msg.userId}`
    }
}

function formatExcerpts(messages: ObservedMessage[]): string[] {
    return messages.slice(-20).map((item) => {
        const name = item.username?.trim() || item.userId
        return `${new Date(item.at).toISOString()} ${name}: ${item.content}`
    })
}

function inCooldown(task: TriggerTask): boolean {
    return (
        task.state.cooldownUntil != null &&
        new Date(task.state.cooldownUntil).valueOf() > Date.now()
    )
}
