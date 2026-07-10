import { StructuredTool } from '@langchain/core/tools'
import type { ChatLunaToolRunnable } from 'koishi-plugin-chatluna/llm-core/platform/types'
import { type Session, type User } from 'koishi'
import { z } from 'zod'
import type { ChatLunaAgentTriggerService } from '../service/trigger'
import type {
    TriggerActor,
    TriggerCreateInput,
    TriggerUpdateInput
} from '../types'
import type { TriggerRunControl } from './control'
import {
    triggerConditionSchema,
    triggerExecutionSchema,
    triggerTargetSchema
} from './schema'

const taskSchema = z.object({
    name: z.string().min(1),
    enabled: z.boolean().optional(),
    condition: triggerConditionSchema,
    execution: triggerExecutionSchema,
    target: triggerTargetSchema
})

export class TriggerTool extends StructuredTool {
    name = 'trigger'
    description =
        'Create and manage Trigger V2 tasks with structured fields. Actions: ' +
        'list, get, create, update, enable, disable, fire, pause_until, resume, remove. ' +
        'Conditions and minimal examples: once runs at one timestamp ' +
        '{type:"once",at:"2026-07-11T09:00:00+08:00"}; calendar runs at ' +
        'selected weekday times {type:"calendar",timezone:"Asia/Shanghai",' +
        'days:[1,2,3,4,5],times:["09:00"],misfire:"skip"}; interval uses ' +
        'an anchored cadence {type:"interval",everyMinutes:30,anchorAt:' +
        '"2026-07-11T09:00:00+08:00",misfire:"fire_once"}; cron uses an ' +
        'advanced schedule {type:"cron",expression:"0 9 * * 1-5",timezone:' +
        '"Asia/Shanghai",misfire:"skip"}; window repeats inside a period ' +
        '{type:"window",timezone:"Asia/Shanghai",days:[1,2,3,4,5],start:' +
        '"08:00",end:"12:00",everyMinutes:20,misfire:"skip",control:' +
        '"fixed",defaultDecision:"continue"}; keyword matches message text ' +
        '{type:"keyword",keywords:["deploy"],caseSensitive:false,' +
        'cooldownMinutes:10}; participation waits for a group threshold ' +
        '{type:"participation",withinMinutes:10,minMessages:5,minUsers:3,' +
        'cooldownMinutes:10,gate:{type:"none"}}; inactivity waits for active ' +
        'chat then silence {type:"inactivity",activeWithinMinutes:10,' +
        'minMessages:5,silentMinutes:20,cooldownMinutes:10,gate:{type:' +
        '"none"}}; semantic uses a model topic gate {type:"semantic",topic:' +
        '"release incident",withinMinutes:10,minMessages:3,cooldownMinutes:' +
        '10,gate:{type:"model",model:{type:"default"},timeoutSeconds:30,' +
        'dailyTokenLimit:1000}}. ' +
        'Days are 0=Sunday through 6=Saturday. Use exact IANA timezones, ISO timestamps, ' +
        'an explicit model policy, conversation policy, tool allowlist, bot, destination, principal, and delivery.'

    schema = z
        .object({
            action: z.enum([
                'list',
                'get',
                'create',
                'update',
                'enable',
                'disable',
                'fire',
                'pause_until',
                'resume',
                'remove'
            ]),
            id: z
                .number()
                .int()
                .positive()
                .optional()
                .describe('Task id for actions other than list/create'),
            task: taskSchema
                .optional()
                .describe('Complete task definition for create/update'),
            at: z
                .string()
                .optional()
                .describe('Future ISO timestamp for pause_until'),
            limit: z
                .number()
                .int()
                .min(1)
                .max(100)
                .optional()
                .describe('Maximum list result count'),
            filter: z
                .object({
                    enabled: z.boolean().optional(),
                    status: z
                        .enum([
                            'waiting',
                            'running',
                            'paused',
                            'completed',
                            'error'
                        ])
                        .optional(),
                    conditionType: z
                        .enum([
                            'once',
                            'calendar',
                            'interval',
                            'cron',
                            'window',
                            'keyword',
                            'participation',
                            'inactivity',
                            'semantic'
                        ])
                        .optional()
                })
                .optional()
        })
        .superRefine((input, ctx) => {
            if (input.action === 'create' || input.action === 'update') {
                if (!input.task) {
                    ctx.addIssue({
                        code: z.ZodIssueCode.custom,
                        path: ['task'],
                        message: 'task is required for create/update.'
                    })
                }
                if (input.action === 'update' && input.task?.enabled == null) {
                    ctx.addIssue({
                        code: z.ZodIssueCode.custom,
                        path: ['task', 'enabled'],
                        message: 'enabled is required for update.'
                    })
                }
            }

            if (
                input.action !== 'list' &&
                input.action !== 'create' &&
                input.id == null
            ) {
                ctx.addIssue({
                    code: z.ZodIssueCode.custom,
                    path: ['id'],
                    message: `id is required for ${input.action}.`
                })
            }

            if (input.action === 'pause_until' && !input.at) {
                ctx.addIssue({
                    code: z.ZodIssueCode.custom,
                    path: ['at'],
                    message: 'at is required for pause_until.'
                })
            }
        })

    constructor(private readonly service: ChatLunaAgentTriggerService) {
        super()
    }

    async _call(
        input: z.infer<typeof this.schema>,
        _: unknown,
        config?: ChatLunaToolRunnable
    ) {
        try {
            const session = config?.configurable.session
            if (!session) return 'Trigger management requires a session.'

            const actor = await createTriggerActor(session)
            if (input.action === 'list') {
                const tasks = await this.service.list(actor, input.filter)
                return JSON.stringify(
                    input.limit ? tasks.slice(0, input.limit) : tasks
                )
            }

            if (input.action === 'create') {
                return JSON.stringify(
                    await this.service.create(
                        actor,
                        input.task as TriggerCreateInput
                    )
                )
            }

            const id = input.id as number
            if (input.action === 'get') {
                return JSON.stringify(await this.service.get(actor, id))
            }
            if (input.action === 'update') {
                return JSON.stringify(
                    await this.service.update(
                        actor,
                        id,
                        input.task as TriggerUpdateInput
                    )
                )
            }
            if (input.action === 'enable') {
                return JSON.stringify(
                    await this.service.setEnabled(actor, id, true)
                )
            }
            if (input.action === 'disable') {
                return JSON.stringify(
                    await this.service.setEnabled(actor, id, false)
                )
            }
            if (input.action === 'fire') {
                return JSON.stringify(await this.service.fire(actor, id))
            }
            if (input.action === 'pause_until') {
                return JSON.stringify(
                    await this.service.pauseUntil(actor, id, input.at as string)
                )
            }
            if (input.action === 'resume') {
                return JSON.stringify(await this.service.resume(actor, id))
            }

            await this.service.remove(actor, id)
            return JSON.stringify({ removed: id })
        } catch (err) {
            return err instanceof Error ? err.message : String(err)
        }
    }
}

export class FinishTriggerRunTool extends StructuredTool {
    name = 'finish_trigger_run'
    description =
        'Control the current Trigger V2 run. Submit one decision: continue, ' +
        'stop_period, complete, pause_until, or reschedule. pause_until and ' +
        'reschedule require a future ISO timestamp in at. The first valid ' +
        'decision wins.'

    schema = z
        .object({
            decision: z.enum([
                'continue',
                'stop_period',
                'complete',
                'pause_until',
                'reschedule'
            ]),
            at: z.string().optional(),
            reason: z.string().max(500).optional()
        })
        .superRefine((input, ctx) => {
            const timed =
                input.decision === 'pause_until' ||
                input.decision === 'reschedule'
            if (timed && !input.at) {
                ctx.addIssue({
                    code: z.ZodIssueCode.custom,
                    path: ['at'],
                    message: `at is required for ${input.decision}.`
                })
            }
            if (!timed && input.at) {
                ctx.addIssue({
                    code: z.ZodIssueCode.custom,
                    path: ['at'],
                    message: `at is not valid for ${input.decision}.`
                })
            }
        })

    constructor(private readonly control: TriggerRunControl) {
        super()
    }

    async _call(
        input: z.infer<typeof this.schema>,
        _: unknown,
        config?: ChatLunaToolRunnable
    ) {
        const requestId =
            config?.configurable.agentContext?.requestId ??
            (config?.configurable as { requestId?: string } | undefined)
                ?.requestId
        if (!requestId) {
            return JSON.stringify({
                ok: false,
                error: 'not-running',
                message: 'No trigger run is active for this request.'
            })
        }
        return JSON.stringify(this.control.submit(requestId, input))
    }
}

async function createTriggerActor(session: Session): Promise<TriggerActor> {
    const user = await session.getUser<User.Field>(session.userId, [
        'authority'
    ])
    return {
        key: `${session.platform}:${session.selfId}:${session.userId}`,
        userId: session.userId,
        authority: user?.authority ?? 0,
        session
    }
}
