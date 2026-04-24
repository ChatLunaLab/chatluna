import { Context } from 'koishi'
import { getBaseBindingKey } from 'koishi-plugin-chatluna/services/chat'
import type {
    TriggerCreateTaskInput,
    TriggerListTaskFilter,
    TriggerTask
} from '../types'

export class ChatLunaAgentTriggerTaskRegistry {
    private readonly _baseBindingKeys = new Map<string, Set<number>>()
    private readonly _bindingKeys = new Map<string, Set<number>>()
    private readonly _tasks = new Map<number, TriggerTask>()
    private _loaded = false

    constructor(private readonly ctx: Context) {
        this.ctx.model.extend(
            'chatluna_trigger_task',
            {
                id: 'unsigned',
                providerKind: { type: 'char', length: 64, nullable: true },
                enabled: { type: 'boolean', initial: true },
                name: { type: 'string', nullable: true },
                bindingKey: { type: 'string', length: 255 },
                presetLane: { type: 'char', length: 255, nullable: true },
                conversationId: { type: 'char', length: 255, nullable: true },
                selfId: 'string',
                platform: 'string',
                userId: 'string',
                username: { type: 'string', nullable: true },
                guildId: { type: 'string', nullable: true },
                channelId: { type: 'string', nullable: true },
                isDirect: 'boolean',
                wakeupTemplate: { type: 'json' },
                params: { type: 'json', nullable: true },
                lastFiredAt: { type: 'timestamp', nullable: true },
                nextFireAt: { type: 'timestamp', nullable: true },
                fireCount: { type: 'unsigned', initial: 0 },
                lastError: { type: 'text', nullable: true },
                source: 'string',
                createdBy: 'string',
                createdAt: 'timestamp',
                updatedAt: 'timestamp'
            },
            {
                autoInc: true,
                primary: 'id'
            }
        )
    }

    async create(input: TriggerCreateTaskInput) {
        this._ensureDatabase()
        const now = new Date()
        const task = await this.ctx.database.create('chatluna_trigger_task', {
            providerKind: input.providerKind ?? null,
            enabled: input.enabled ?? true,
            name: input.name?.trim() || null,
            bindingKey: input.bindingKey,
            presetLane: input.presetLane ?? null,
            conversationId: input.conversationId ?? null,
            selfId: input.selfId,
            platform: input.platform,
            userId: input.userId,
            username: input.username ?? null,
            guildId: input.guildId ?? null,
            channelId: input.channelId ?? null,
            isDirect: input.isDirect,
            wakeupTemplate: input.wakeupTemplate,
            params: input.params ?? null,
            nextFireAt:
                input.nextFireAt == null ? null : new Date(input.nextFireAt),
            fireCount: 0,
            lastFiredAt: null,
            lastError: null,
            source: input.source ?? 'webui',
            createdBy: input.createdBy,
            createdAt: now,
            updatedAt: now
        })
        this._set(task)
        return task
    }

    async update(id: number, patch: Partial<TriggerTask>) {
        const task = await this.get(id)
        if (!task) {
            throw new Error(`Trigger task not found: ${id}`)
        }

        await this.ctx.database.set('chatluna_trigger_task', id, {
            ...patch,
            updatedAt: new Date()
        })

        const updated = (
            await this.ctx.database.get('chatluna_trigger_task', [id])
        )[0]
        if (updated == null) {
            throw new Error(`Trigger task removed concurrently: ${id}`)
        }

        this._delete(task)
        this._set(updated)
        return updated
    }

    async remove(id: number) {
        const task = await this.get(id)
        await this.ctx.database.remove('chatluna_trigger_task', [id])
        if (task != null) {
            this._delete(task)
        }
    }

    async get(id: number) {
        if (this._loaded) {
            return this._tasks.get(id)
        }

        this._ensureDatabase()
        const task = (
            await this.ctx.database.get('chatluna_trigger_task', [id])
        )[0]
        if (task != null) {
            this._set(task)
        }
        return task
    }

    async list(filter?: TriggerListTaskFilter) {
        await this._load()
        return [...this._tasks.values()]
            .filter((task) => {
                if (
                    filter?.providerKind !== undefined &&
                    task.providerKind !== filter.providerKind
                ) {
                    return false
                }

                if (
                    filter?.enabled !== undefined &&
                    task.enabled !== filter.enabled
                ) {
                    return false
                }

                return true
            })
            .sort((a, b) => b.createdAt.valueOf() - a.createdAt.valueOf())
    }

    async listByBindingKey(
        bindingKey: string,
        enabled?: boolean,
        includeAllScope = false
    ) {
        await this._load()
        const ids = new Set<number>(this._bindingKeys.get(bindingKey) ?? [])
        if (includeAllScope) {
            const baseKey = getBaseBindingKey(bindingKey)
            const baseIds = this._baseBindingKeys.get(baseKey)
            if (baseIds != null) {
                for (const id of baseIds) {
                    const task = this._tasks.get(id)
                    if (task != null && !task.bindingKey.includes(':preset:')) {
                        ids.add(id)
                    }
                }
            }
        }

        if (ids.size < 1) {
            return []
        }

        return [...ids]
            .map((id) => this._tasks.get(id))
            .filter((task): task is TriggerTask => task != null)
            .filter((task) => {
                if (enabled === undefined) {
                    return true
                }

                return task.enabled === enabled
            })
            .sort((a, b) => b.createdAt.valueOf() - a.createdAt.valueOf())
    }

    private async _load() {
        if (this._loaded) {
            return
        }

        this._ensureDatabase()
        this._bindingKeys.clear()
        this._baseBindingKeys.clear()
        this._tasks.clear()
        const tasks = await this.ctx.database.get('chatluna_trigger_task', {})
        for (const task of tasks) {
            this._set(task)
        }
        this._loaded = true
    }

    private _set(task: TriggerTask) {
        const prev = this._tasks.get(task.id)
        if (prev != null) {
            this._delete(prev)
        }

        this._tasks.set(task.id, task)
        const ids = this._bindingKeys.get(task.bindingKey) ?? new Set<number>()
        ids.add(task.id)
        this._bindingKeys.set(task.bindingKey, ids)

        const baseKey = getBaseBindingKey(task.bindingKey)
        const baseIds = this._baseBindingKeys.get(baseKey) ?? new Set<number>()
        baseIds.add(task.id)
        this._baseBindingKeys.set(baseKey, baseIds)
    }

    private _ensureDatabase() {
        if (this.ctx.database == null) {
            throw new Error(
                'Trigger task registry requires the koishi database service.'
            )
        }
    }

    private _delete(task: TriggerTask) {
        this._tasks.delete(task.id)
        const ids = this._bindingKeys.get(task.bindingKey)
        if (ids != null) {
            ids.delete(task.id)
            if (ids.size < 1) {
                this._bindingKeys.delete(task.bindingKey)
            }
        }

        const baseKey = getBaseBindingKey(task.bindingKey)
        const baseIds = this._baseBindingKeys.get(baseKey)
        if (baseIds != null) {
            baseIds.delete(task.id)
            if (baseIds.size < 1) {
                this._baseBindingKeys.delete(baseKey)
            }
        }
    }
}
