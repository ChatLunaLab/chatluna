import type { Context } from 'koishi'
import type {
    TriggerListFilter,
    TriggerRun,
    TriggerRunCreateInput,
    TriggerRunFinishInput,
    TriggerStoreCreateInput,
    TriggerStoreUpdate,
    TriggerTask
} from '../types/trigger'
import {
    triggerConditionSchema,
    triggerCreateInputSchema,
    triggerExecutionSchema,
    triggerTargetSchema,
    triggerTaskStateSchema
} from './schema'

export class TriggerStore {
    constructor(private readonly ctx: Context) {
        ctx.model.extend(
            'chatluna_trigger',
            {
                id: 'unsigned',
                name: 'string',
                enabled: { type: 'boolean', initial: true },
                condition: 'json',
                execution: 'json',
                target: 'json',
                state: 'json',
                ownerKey: 'string',
                createdAt: 'timestamp',
                updatedAt: 'timestamp'
            } as never,
            { autoInc: true, primary: 'id' } as never
        )
        ctx.model.extend(
            'chatluna_trigger_run',
            {
                id: { type: 'char', length: 36 },
                taskId: 'unsigned',
                origin: 'string',
                status: 'string',
                scheduledAt: { type: 'timestamp', nullable: true },
                startedAt: 'timestamp',
                finishedAt: { type: 'timestamp', nullable: true },
                decision: { type: 'json', nullable: true },
                error: { type: 'text', nullable: true },
                usage: { type: 'json', nullable: true },
                createdAt: 'timestamp'
            } as never,
            { primary: 'id' } as never
        )
    }

    async create(input: TriggerStoreCreateInput): Promise<TriggerTask> {
        this._checkDatabase()
        const parsed = triggerCreateInputSchema.parse({
            name: input.name,
            enabled: input.enabled,
            condition: input.condition,
            execution: input.execution,
            target: input.target
        })
        const now = new Date()
        return await this.ctx.database.create('chatluna_trigger', {
            name: parsed.name,
            enabled: parsed.enabled,
            condition: parsed.condition,
            execution: parsed.execution,
            target: parsed.target,
            state: triggerTaskStateSchema.parse(
                input.state
            ) as TriggerStoreCreateInput['state'],
            ownerKey: input.ownerKey,
            createdAt: now,
            updatedAt: now
        })
    }

    async get(id: number): Promise<TriggerTask | undefined> {
        this._checkDatabase()
        return (
            await this.ctx.database.get('chatluna_trigger', { id } as never)
        )[0]
    }

    async list(filter?: TriggerListFilter): Promise<TriggerTask[]> {
        this._checkDatabase()
        const tasks = await this.ctx.database.get(
            'chatluna_trigger',
            {} as never
        )
        return tasks
            .filter((task) => {
                if (
                    filter?.ownerKey != null &&
                    task.ownerKey !== filter.ownerKey
                ) {
                    return false
                }
                if (
                    filter?.enabled != null &&
                    task.enabled !== filter.enabled
                ) {
                    return false
                }
                if (
                    filter?.status != null &&
                    task.state.status !== filter.status
                ) {
                    return false
                }
                return (
                    filter?.conditionType == null ||
                    task.condition.type === filter.conditionType
                )
            })
            .sort((a, b) => b.createdAt.valueOf() - a.createdAt.valueOf())
    }

    async update(id: number, patch: TriggerStoreUpdate): Promise<TriggerTask> {
        this._checkDatabase()
        if ((await this.get(id)) == null) {
            throw new Error(`Trigger task not found: ${id}`)
        }
        const next: TriggerStoreUpdate & { updatedAt: Date } = {
            updatedAt: new Date()
        }
        if (patch.name !== undefined) {
            next.name = patch.name.trim()
            if (next.name.length < 1)
                throw new Error('Trigger name is required')
        }
        if (patch.enabled !== undefined) next.enabled = patch.enabled
        if (patch.condition !== undefined) {
            next.condition = triggerConditionSchema.parse(
                patch.condition
            ) as TriggerTask['condition']
        }
        if (patch.execution !== undefined) {
            next.execution = triggerExecutionSchema.parse(
                patch.execution
            ) as TriggerTask['execution']
        }
        if (patch.target !== undefined) {
            next.target = triggerTargetSchema.parse(
                patch.target
            ) as TriggerTask['target']
        }
        if (patch.state !== undefined) {
            next.state = triggerTaskStateSchema.parse(
                patch.state
            ) as TriggerTask['state']
        }
        await this.ctx.database.set(
            'chatluna_trigger',
            { id } as never,
            next as never
        )
        const task = await this.get(id)
        if (task == null) {
            throw new Error(`Trigger task removed concurrently: ${id}`)
        }
        return task
    }

    async remove(id: number): Promise<void> {
        this._checkDatabase()
        await this.ctx.database.transact(async (db) => {
            await db.remove('chatluna_trigger_run', { taskId: id } as never)
            await db.remove('chatluna_trigger', { id } as never)
        })
    }

    async listRunning(): Promise<TriggerTask[]> {
        return await this.list({ status: 'running' })
    }

    async failRunningRuns(error: string): Promise<void> {
        this._checkDatabase()
        const runs = await this.ctx.database.get('chatluna_trigger_run', {
            status: 'running'
        } as never)
        const now = new Date()
        for (const run of runs) {
            await this.ctx.database.set(
                'chatluna_trigger_run',
                { id: run.id } as never,
                {
                    status: 'failed',
                    finishedAt: now,
                    error
                } as never
            )
        }
    }

    async createRun(input: TriggerRunCreateInput): Promise<TriggerRun> {
        this._checkDatabase()
        return await this.ctx.database.create('chatluna_trigger_run', {
            id: input.id,
            taskId: input.taskId,
            origin: input.origin,
            status: input.status,
            scheduledAt: input.scheduledAt ?? null,
            startedAt: input.startedAt,
            finishedAt: input.finishedAt ?? null,
            decision: input.decision ?? null,
            error: input.error ?? null,
            usage: input.usage ?? null,
            createdAt: input.createdAt ?? new Date()
        })
    }

    async finishRun(
        id: string,
        patch: TriggerRunFinishInput
    ): Promise<TriggerRun> {
        this._checkDatabase()
        const next: TriggerRunFinishInput = {}
        if (patch.status !== undefined) next.status = patch.status
        if (patch.finishedAt !== undefined) next.finishedAt = patch.finishedAt
        if (patch.decision !== undefined) next.decision = patch.decision
        if (patch.error !== undefined) next.error = patch.error
        if (patch.usage !== undefined) next.usage = patch.usage
        await this.ctx.database.set(
            'chatluna_trigger_run',
            { id } as never,
            next as never
        )
        const run = (
            await this.ctx.database.get('chatluna_trigger_run', { id } as never)
        )[0]
        if (run == null) throw new Error(`Trigger run not found: ${id}`)
        return run
    }

    async finishTaskRun(
        taskId: number,
        state: TriggerTask['state'],
        runId: string,
        patch: TriggerRunFinishInput
    ): Promise<{ task: TriggerTask; run: TriggerRun }> {
        this._checkDatabase()
        const parsed = triggerTaskStateSchema.parse(state)
        await this.ctx.database.transact(async (db) => {
            await db.set(
                'chatluna_trigger',
                { id: taskId } as never,
                { state: parsed, updatedAt: new Date() } as never
            )
            await db.set(
                'chatluna_trigger_run',
                { id: runId } as never,
                patch as never
            )
        })
        const task = await this.get(taskId)
        const run = (
            await this.ctx.database.get('chatluna_trigger_run', {
                id: runId
            } as never)
        )[0]
        if (task == null) throw new Error(`Trigger task not found: ${taskId}`)
        if (run == null) throw new Error(`Trigger run not found: ${runId}`)
        return { task, run }
    }

    async listRuns(taskId: number, limit = 20): Promise<TriggerRun[]> {
        this._checkDatabase()
        return (
            await this.ctx.database.get('chatluna_trigger_run', {
                taskId
            } as never)
        )
            .sort((a, b) => b.createdAt.valueOf() - a.createdAt.valueOf())
            .slice(0, Math.max(1, Math.min(limit, 100)))
    }

    private _checkDatabase() {
        if (this.ctx.database == null) {
            throw new Error('Trigger V2 requires the Koishi database service')
        }
    }
}

declare module 'koishi' {
    interface Tables {
        chatluna_trigger: TriggerTask
        chatluna_trigger_run: TriggerRun
    }
}
