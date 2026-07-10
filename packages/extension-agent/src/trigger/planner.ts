import { CronExpressionParser } from 'cron-parser'
import { DateTime } from 'luxon'
import type {
    TriggerCondition,
    TriggerRun,
    TriggerRunDecision,
    TriggerTask,
    TriggerTaskState,
    TriggerTaskStatus
} from '../types/trigger'
import { triggerConditionSchema } from './schema'

export interface TriggerPlan {
    status: TriggerTaskStatus
    nextRunAt: Date | null
    suppressedUntil?: Date | null
    periodKey?: string | null
    occurrenceKey?: string | null
}

export interface TriggerPlanInput {
    misfire?: boolean
    resume?: boolean
    skipPeriod?: string
}

interface Occurrence {
    at: Date
    periodKey?: string
    occurrenceKey: string
}

type EventCondition = Extract<
    TriggerCondition,
    {
        type: 'keyword' | 'participation' | 'inactivity' | 'semantic'
    }
>

const eventTypes = new Set<TriggerCondition['type']>([
    'keyword',
    'participation',
    'inactivity',
    'semantic'
])

export class TriggerPlanner {
    validate(condition: TriggerCondition): TriggerCondition {
        return triggerConditionSchema.parse(condition) as TriggerCondition
    }

    initialState(
        task: Pick<TriggerTask, 'enabled' | 'condition'> &
            Partial<Pick<TriggerTask, 'updatedAt'>>,
        now: Date
    ): TriggerTaskState {
        const condition = this.validate(task.condition)
        if (!task.enabled) {
            return {
                status: 'paused',
                nextRunAt: null,
                suppressedUntil: null,
                runCount: 0
            }
        }
        if (isEventCondition(condition)) {
            return {
                status: 'waiting',
                nextRunAt: null,
                suppressedUntil: null,
                runCount: 0
            }
        }
        if (condition.type === 'once') {
            const at = new Date(condition.at)
            return {
                status: 'waiting',
                nextRunAt: new Date(
                    Math.max(at.valueOf(), now.valueOf())
                ).toISOString(),
                suppressedUntil: null,
                runCount: 0,
                occurrenceKey: at.toISOString()
            }
        }
        const occurrence = findOccurrence(condition, now)
        return {
            status: 'waiting',
            nextRunAt: occurrence.at.toISOString(),
            suppressedUntil: null,
            runCount: 0,
            periodKey: occurrence.periodKey ?? null,
            occurrenceKey: occurrence.occurrenceKey
        }
    }

    next(
        task: TriggerTask,
        now: Date,
        input: TriggerPlanInput = {}
    ): TriggerPlan {
        const condition = this.validate(task.condition)
        if (!task.enabled) {
            return {
                status: 'paused',
                nextRunAt: null,
                suppressedUntil: null,
                periodKey: null,
                occurrenceKey: null
            }
        }
        if (task.state.status === 'completed' && input.resume !== true) {
            return {
                status: 'completed',
                nextRunAt: null,
                suppressedUntil: null,
                periodKey: null,
                occurrenceKey: null
            }
        }
        if (task.state.status === 'paused' && input.resume !== true) {
            const until = task.state.suppressedUntil
                ? new Date(task.state.suppressedUntil)
                : null
            if (until == null || until.valueOf() > now.valueOf()) {
                return {
                    status: 'paused',
                    nextRunAt: until,
                    suppressedUntil: until,
                    periodKey: task.state.periodKey,
                    occurrenceKey: task.state.occurrenceKey
                }
            }
        }
        if (isEventCondition(condition)) {
            return {
                status: 'waiting',
                nextRunAt: null,
                suppressedUntil: null,
                periodKey: null,
                occurrenceKey: null
            }
        }
        if (condition.type === 'once') {
            if (task.state.runCount > 0 && input.resume !== true) {
                return {
                    status: 'completed',
                    nextRunAt: null,
                    suppressedUntil: null,
                    periodKey: null,
                    occurrenceKey: null
                }
            }
            return {
                status: 'waiting',
                nextRunAt: new Date(
                    Math.max(new Date(condition.at).valueOf(), now.valueOf())
                ),
                suppressedUntil: null,
                periodKey: null,
                occurrenceKey: new Date(condition.at).toISOString()
            }
        }
        if (
            input.misfire === true &&
            condition.misfire === 'fire_once' &&
            task.state.nextRunAt != null &&
            new Date(task.state.nextRunAt).valueOf() <= now.valueOf()
        ) {
            return {
                status: 'waiting',
                nextRunAt: now,
                suppressedUntil: null,
                periodKey: task.state.periodKey,
                occurrenceKey: task.state.occurrenceKey
            }
        }
        const occurrence = findOccurrence(
            condition,
            now,
            input.skipPeriod,
            task.state.occurrenceKey ?? undefined
        )
        return {
            status: 'waiting',
            nextRunAt: occurrence.at,
            suppressedUntil: null,
            periodKey: occurrence.periodKey ?? null,
            occurrenceKey: occurrence.occurrenceKey
        }
    }

    decide(
        task: TriggerTask,
        decision?: TriggerRunDecision | null
    ): TriggerRunDecision {
        const condition = this.validate(task.condition)
        if (condition.type === 'once') {
            if (
                decision?.type === 'pause_until' ||
                decision?.type === 'reschedule'
            ) {
                return decision
            }
            return decision?.type === 'complete'
                ? decision
                : { type: 'complete', reason: decision?.reason }
        }
        if (condition.type === 'window') {
            if (
                decision?.type === 'complete' ||
                decision?.type === 'pause_until' ||
                decision?.type === 'reschedule'
            ) {
                return decision
            }
            if (
                condition.control === 'fixed' ||
                (decision?.type !== 'continue' &&
                    decision?.type !== 'stop_period')
            ) {
                return { type: condition.defaultDecision }
            }
            return decision
        }
        if (isEventCondition(condition)) {
            return decision ?? { type: 'continue' }
        }
        if (decision?.type === 'stop_period' || decision == null) {
            return { type: 'continue', reason: decision?.reason }
        }
        return decision
    }

    afterRun(
        task: TriggerTask,
        run: TriggerRun,
        decision: TriggerRunDecision | null | undefined,
        now: Date
    ): TriggerPlan {
        const resolved = this.decide(task, decision)
        if (resolved.type === 'complete') {
            return {
                status: 'completed',
                nextRunAt: null,
                suppressedUntil: null,
                periodKey: null,
                occurrenceKey: null
            }
        }
        if (resolved.type === 'pause_until' || resolved.type === 'reschedule') {
            const at = new Date(resolved.at)
            if (Number.isNaN(at.valueOf()) || at.valueOf() <= now.valueOf()) {
                throw new Error(
                    `${resolved.type} requires a future ISO timestamp`
                )
            }
            return {
                status: resolved.type === 'pause_until' ? 'paused' : 'waiting',
                nextRunAt: at,
                suppressedUntil: resolved.type === 'pause_until' ? at : null,
                periodKey: null,
                occurrenceKey: `override:${at.toISOString()}`
            }
        }
        const condition = this.validate(task.condition)
        if (condition.type === 'once') {
            return {
                status: 'completed',
                nextRunAt: null,
                suppressedUntil: null,
                periodKey: null,
                occurrenceKey: null
            }
        }
        if (isEventCondition(condition)) {
            return {
                status: 'waiting',
                nextRunAt: null,
                suppressedUntil: null,
                periodKey: null,
                occurrenceKey: null
            }
        }
        const occurrence = findOccurrence(
            condition,
            now,
            condition.type === 'window' && resolved.type === 'stop_period'
                ? (task.state.periodKey ?? undefined)
                : undefined,
            task.state.occurrenceKey ?? undefined
        )
        return {
            status: 'waiting',
            nextRunAt: occurrence.at,
            suppressedUntil: null,
            periodKey: occurrence.periodKey ?? null,
            occurrenceKey: occurrence.occurrenceKey
        }
    }

    preview(
        condition: TriggerCondition,
        count: number,
        now = new Date()
    ): Date[] {
        const parsed = this.validate(condition)
        if (isEventCondition(parsed)) return []
        if (parsed.type === 'once') {
            return [
                new Date(Math.max(new Date(parsed.at).valueOf(), now.valueOf()))
            ].slice(0, count)
        }
        const result: Date[] = []
        let base = now
        let occurrenceKey: string | undefined
        for (let idx = 0; idx < count; idx++) {
            const occurrence = findOccurrence(
                parsed,
                base,
                undefined,
                occurrenceKey
            )
            result.push(occurrence.at)
            base = occurrence.at
            occurrenceKey = occurrence.occurrenceKey
        }
        return result
    }
}

function isEventCondition(
    condition: TriggerCondition
): condition is EventCondition {
    return eventTypes.has(condition.type)
}

function findOccurrence(
    condition: Exclude<
        TriggerCondition,
        {
            type:
                'once' | 'keyword' | 'participation' | 'inactivity' | 'semantic'
        }
    >,
    after: Date,
    skipPeriod?: string,
    occurrenceKey?: string
): Occurrence {
    if (condition.type === 'interval') {
        const anchor = new Date(condition.anchorAt).valueOf()
        const every = condition.everyMinutes * 60_000
        const index = Math.max(
            0,
            Math.floor((after.valueOf() - anchor) / every) + 1
        )
        const at = new Date(anchor + index * every)
        return { at, occurrenceKey: at.toISOString() }
    }
    if (condition.type === 'cron') {
        const at = new Date(
            CronExpressionParser.parse(condition.expression, {
                currentDate: after,
                tz: condition.timezone
            })
                .next()
                .getTime()
        )
        return { at, occurrenceKey: at.toISOString() }
    }
    if (condition.type === 'calendar') {
        const base = DateTime.fromJSDate(after, { zone: condition.timezone })
        for (let offset = 0; offset < 370; offset++) {
            const day = base.startOf('day').plus({ days: offset })
            if (!condition.days.includes(day.weekday % 7)) continue
            for (const value of condition.times) {
                const [hour, minute] = value.split(':').map(Number)
                const at = DateTime.fromObject(
                    {
                        year: day.year,
                        month: day.month,
                        day: day.day,
                        hour,
                        minute
                    },
                    { zone: condition.timezone }
                )
                if (
                    !at.isValid ||
                    at.year !== day.year ||
                    at.month !== day.month ||
                    at.day !== day.day ||
                    at.hour !== hour ||
                    at.minute !== minute ||
                    at.toMillis() <= after.valueOf()
                ) {
                    continue
                }
                const key = `${at.toFormat('yyyy-MM-dd')}T${value}`
                if (key === occurrenceKey) continue
                return { at: at.toJSDate(), occurrenceKey: key }
            }
        }
        throw new Error('Unable to find a calendar occurrence')
    }
    const base = DateTime.fromJSDate(after, {
        zone: condition.timezone
    }).startOf('day')
    for (let offset = -1; offset < 370; offset++) {
        const day = base.plus({ days: offset })
        if (!condition.days.includes(day.weekday % 7)) continue
        const periodKey = day.toFormat('yyyy-MM-dd')
        if (skipPeriod != null && periodKey <= skipPeriod) continue
        const [startHour, startMinute] = condition.start.split(':').map(Number)
        const start = DateTime.fromObject(
            {
                year: day.year,
                month: day.month,
                day: day.day,
                hour: startHour,
                minute: startMinute
            },
            { zone: condition.timezone }
        )
        if (
            !start.isValid ||
            start.year !== day.year ||
            start.month !== day.month ||
            start.day !== day.day ||
            start.hour !== startHour ||
            start.minute !== startMinute
        ) {
            continue
        }
        const startMinutes = startHour * 60 + startMinute
        const [endHour, endMinute] = condition.end.split(':').map(Number)
        const endMinutes = endHour * 60 + endMinute
        const duration =
            condition.start < condition.end
                ? endMinutes - startMinutes
                : 1440 - startMinutes + endMinutes
        for (
            let elapsed = 0;
            elapsed < duration;
            elapsed += condition.everyMinutes
        ) {
            const total = startMinutes + elapsed
            const slotDay = day.plus({ days: Math.floor(total / 1440) })
            const minute = total % 1440
            const hour = Math.floor(minute / 60)
            const at = DateTime.fromObject(
                {
                    year: slotDay.year,
                    month: slotDay.month,
                    day: slotDay.day,
                    hour,
                    minute: minute % 60
                },
                { zone: condition.timezone }
            )
            if (
                !at.isValid ||
                at.year !== slotDay.year ||
                at.month !== slotDay.month ||
                at.day !== slotDay.day ||
                at.hour !== hour ||
                at.minute !== minute % 60
            ) {
                continue
            }
            if (at.toMillis() <= after.valueOf()) continue
            const key = `${periodKey}T${at.toFormat('HH:mm')}`
            if (key === occurrenceKey) continue
            return {
                at: at.toJSDate(),
                periodKey,
                occurrenceKey: key
            }
        }
    }
    throw new Error('Unable to find a window occurrence')
}
