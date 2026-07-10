import { CronExpressionParser } from 'cron-parser'
import { DateTime, IANAZone } from 'luxon'
import { z } from 'zod'
import type {
    TriggerCondition,
    TriggerCreateInput,
    TriggerExecution,
    TriggerTarget,
    TriggerTaskState,
    TriggerUpdateInput,
    TriggerWakeupInput
} from '../types/trigger'

const text = z.string().trim().min(1)
const iso = z
    .string()
    .refine(
        (value) =>
            value.includes('T') &&
            DateTime.fromISO(value, { setZone: true }).isValid,
        'Expected a valid ISO timestamp'
    )
const timezone = z
    .string()
    .trim()
    .refine((value) => IANAZone.isValidZone(value), 'Invalid IANA timezone')
const time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Expected HH:mm')
const days = z
    .array(z.number().int().min(0).max(6))
    .min(1)
    .transform((value) => [...new Set(value)].sort((a, b) => a - b))
const misfire = z.enum(['skip', 'fire_once'])
const positive = z.number().int().min(1)
const windowMinutes = positive.max(30)
const threshold = positive.max(100)

export const triggerModelPolicySchema = z.discriminatedUnion('type', [
    z.object({ type: z.literal('default') }).strict(),
    z.object({ type: z.literal('fixed'), model: text }).strict()
])

export const triggerConversationPolicySchema = z.discriminatedUnion('type', [
    z.object({ type: z.literal('task') }).strict(),
    z.object({ type: z.literal('fresh') }).strict(),
    z.object({ type: z.literal('route') }).strict(),
    z
        .object({
            type: z.literal('existing'),
            conversationId: text
        })
        .strict()
])

export const triggerToolPolicySchema = z.discriminatedUnion('type', [
    z.object({ type: z.literal('none') }).strict(),
    z
        .object({
            type: z.literal('allow'),
            names: z.array(text).transform((value) => [...new Set(value)])
        })
        .strict()
])

const modelGate = z
    .object({
        type: z.literal('model'),
        model: triggerModelPolicySchema,
        prompt: z.string().trim().min(1).optional(),
        timeoutSeconds: positive,
        dailyTokenLimit: positive
    })
    .strict()

export const triggerGateSchema = z.discriminatedUnion('type', [
    z.object({ type: z.literal('none') }).strict(),
    modelGate
])

export const triggerConditionSchema = z
    .discriminatedUnion('type', [
        z.object({ type: z.literal('once'), at: iso }).strict(),
        z
            .object({
                type: z.literal('calendar'),
                timezone,
                days,
                times: z
                    .array(time)
                    .min(1)
                    .transform((value) => [...new Set(value)].sort()),
                misfire
            })
            .strict(),
        z
            .object({
                type: z.literal('interval'),
                everyMinutes: positive,
                anchorAt: iso,
                misfire
            })
            .strict(),
        z
            .object({
                type: z.literal('cron'),
                expression: text,
                timezone,
                misfire
            })
            .strict(),
        z
            .object({
                type: z.literal('window'),
                timezone,
                days,
                start: time,
                end: time,
                everyMinutes: positive,
                misfire,
                control: z.enum(['fixed', 'model']),
                defaultDecision: z.enum(['continue', 'stop_period'])
            })
            .strict(),
        z
            .object({
                type: z.literal('keyword'),
                keywords: z
                    .array(z.string())
                    .transform((value) => [
                        ...new Set(
                            value.map((item) => item.trim()).filter(Boolean)
                        )
                    ])
                    .refine(
                        (value) => value.length > 0,
                        'At least one keyword is required'
                    ),
                caseSensitive: z.boolean(),
                cooldownMinutes: positive
            })
            .strict(),
        z
            .object({
                type: z.literal('participation'),
                withinMinutes: windowMinutes,
                minMessages: threshold,
                minUsers: threshold,
                cooldownMinutes: positive,
                gate: triggerGateSchema
            })
            .strict(),
        z
            .object({
                type: z.literal('inactivity'),
                activeWithinMinutes: windowMinutes,
                minMessages: threshold,
                silentMinutes: positive,
                cooldownMinutes: positive,
                gate: triggerGateSchema
            })
            .strict(),
        z
            .object({
                type: z.literal('semantic'),
                topic: text,
                withinMinutes: windowMinutes,
                minMessages: threshold,
                cooldownMinutes: positive,
                gate: modelGate
            })
            .strict()
    ])
    .superRefine((value, ctx) => {
        if (value.type !== 'cron') return
        try {
            CronExpressionParser.parse(value.expression, {
                currentDate: new Date(),
                tz: value.timezone
            })
        } catch (err) {
            ctx.addIssue({
                code: z.ZodIssueCode.custom,
                path: ['expression'],
                message:
                    err instanceof Error
                        ? err.message
                        : 'Invalid cron expression'
            })
        }
    }) as unknown as z.ZodType<TriggerCondition>

export const triggerExecutionSchema = z
    .object({
        model: triggerModelPolicySchema,
        conversation: triggerConversationPolicySchema,
        preset: z.string().trim().min(1).nullable().optional(),
        prompt: z.string().trim().min(1),
        timeoutSeconds: positive,
        tools: triggerToolPolicySchema.default({ type: 'none' })
    })
    .strict() as unknown as z.ZodType<TriggerExecution>

export const triggerDestinationSchema = z.discriminatedUnion('type', [
    z.object({ type: z.literal('direct'), userId: text }).strict(),
    z
        .object({
            type: z.literal('channel'),
            guildId: text.optional(),
            channelId: text
        })
        .strict()
])

export const triggerTargetSchema = z
    .object({
        bot: z.object({ platform: text, selfId: text }).strict(),
        destination: triggerDestinationSchema,
        principalId: text,
        observeScope: z.enum(['channel', 'guild', 'direct']).optional(),
        delivery: z.enum(['channel', 'direct', 'silent'])
    })
    .strict() as unknown as z.ZodType<TriggerTarget>

const definition = {
    name: text,
    condition: triggerConditionSchema,
    execution: triggerExecutionSchema,
    target: triggerTargetSchema
}

function checkScope(
    value: {
        condition: z.infer<typeof triggerConditionSchema>
        target: z.infer<typeof triggerTargetSchema>
    },
    ctx: z.RefinementCtx
) {
    const event = [
        'keyword',
        'participation',
        'inactivity',
        'semantic'
    ].includes(value.condition.type)
    if (event && value.target.observeScope == null) {
        ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['target', 'observeScope'],
            message: 'observeScope is required for message conditions'
        })
    }
    if (!event && value.target.observeScope != null) {
        ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['target', 'observeScope'],
            message: 'observeScope is only valid for message conditions'
        })
    }
    const scope = value.target.observeScope
    const dest = value.target.destination
    if (scope === 'channel' || scope === 'guild') {
        if (dest.type !== 'channel') {
            ctx.addIssue({
                code: z.ZodIssueCode.custom,
                path: ['target', 'destination'],
                message: `${scope} observation requires a channel destination`
            })
        }
    }
    if (scope === 'guild') {
        if (
            dest.type !== 'channel' ||
            dest.guildId == null ||
            dest.guildId === ''
        ) {
            ctx.addIssue({
                code: z.ZodIssueCode.custom,
                path: ['target', 'destination', 'guildId'],
                message: 'guild observation requires guildId'
            })
        }
    }
    if (scope === 'direct') {
        if (dest.type !== 'direct') {
            ctx.addIssue({
                code: z.ZodIssueCode.custom,
                path: ['target', 'destination'],
                message: 'direct observation requires a direct destination'
            })
        }
    }
}

export const triggerCreateInputSchema = z
    .object({ ...definition, enabled: z.boolean().optional().default(true) })
    .strict()
    .superRefine(checkScope) as unknown as z.ZodType<
    TriggerCreateInput & { enabled: boolean }
>

export const triggerUpdateInputSchema = z
    .object({ ...definition, enabled: z.boolean() })
    .strict()
    .superRefine(checkScope) as unknown as z.ZodType<TriggerUpdateInput>

export const triggerWakeupInputSchema = z
    .object({
        execution: triggerExecutionSchema,
        target: triggerTargetSchema
    })
    .strict() as unknown as z.ZodType<TriggerWakeupInput>

export const triggerRunDecisionSchema = z
    .object({
        decision: z.enum([
            'continue',
            'stop_period',
            'complete',
            'pause_until',
            'reschedule'
        ]),
        at: iso.optional(),
        reason: z.string().max(500).optional()
    })
    .strict()
    .superRefine((value, ctx) => {
        const timed =
            value.decision === 'pause_until' || value.decision === 'reschedule'
        if (timed && value.at == null) {
            ctx.addIssue({
                code: z.ZodIssueCode.custom,
                path: ['at'],
                message: `at is required for ${value.decision}`
            })
        }
        if (!timed && value.at != null) {
            ctx.addIssue({
                code: z.ZodIssueCode.custom,
                path: ['at'],
                message: `at is not valid for ${value.decision}`
            })
        }
    })
    .transform((value) => {
        if (
            value.decision === 'pause_until' ||
            value.decision === 'reschedule'
        ) {
            return {
                type: value.decision,
                at: value.at as string,
                ...(value.reason == null ? {} : { reason: value.reason })
            }
        }
        return {
            type: value.decision,
            ...(value.reason == null ? {} : { reason: value.reason })
        }
    })

export const finishTriggerRunSchema = triggerRunDecisionSchema

export const triggerTaskStateSchema = z
    .object({
        status: z.enum(['waiting', 'running', 'paused', 'completed', 'error']),
        nextRunAt: iso.nullable().optional(),
        suppressedUntil: iso.nullable().optional(),
        lastRunAt: iso.nullable().optional(),
        lastDecision: z
            .union([
                z
                    .object({
                        type: z.literal('continue'),
                        reason: z.string().max(500).optional()
                    })
                    .strict(),
                z
                    .object({
                        type: z.literal('stop_period'),
                        reason: z.string().max(500).optional()
                    })
                    .strict(),
                z
                    .object({
                        type: z.literal('complete'),
                        reason: z.string().max(500).optional()
                    })
                    .strict(),
                z
                    .object({
                        type: z.literal('pause_until'),
                        at: iso,
                        reason: z.string().max(500).optional()
                    })
                    .strict(),
                z
                    .object({
                        type: z.literal('reschedule'),
                        at: iso,
                        reason: z.string().max(500).optional()
                    })
                    .strict()
            ])
            .nullable()
            .optional(),
        runCount: z.number().int().min(0),
        lastError: z.string().nullable().optional(),
        periodKey: z.string().nullable().optional(),
        occurrenceKey: z.string().nullable().optional(),
        cooldownUntil: iso.nullable().optional(),
        cursor: z.record(z.unknown()).nullable().optional()
    })
    .strict() as unknown as z.ZodType<TriggerTaskState>

export const triggerPreviewCountSchema = z.number().int().min(1).max(100)
