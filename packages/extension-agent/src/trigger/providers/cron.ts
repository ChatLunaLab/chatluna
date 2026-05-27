import { CronExpressionParser } from 'cron-parser'
import { z } from 'zod'
import type { TriggerProvider } from '../../types'

export const cronTriggerProvider: TriggerProvider = {
    kind: 'cron',
    name: 'Cron 定时',
    description: '使用标准 cron 表达式定时唤醒代理。',
    scheduled: true,
    needsMessage: true,
    schema: z.object({
        expression: z
            .string()
            .describe(
                '使用标准 cron 表达式，例如 */5 * * * * 或 0 9 * * 1-5。'
            ),
        missedRunPolicy: z
            .enum(['skip', 'fire_once'])
            .default('skip')
            .describe('任务过期未执行时：跳过本次，或补执行一次。')
    }),
    prepare({ input }) {
        const expression = (
            input.params?.expression as string | undefined
        )?.trim()
        if (!expression) {
            throw new Error('Cron expression is required')
        }

        return {
            nextFireAt: new Date(
                CronExpressionParser.parse(expression).next().getTime()
            ),
            params: {
                ...input.params,
                expression,
                missedRunPolicy: input.params?.missedRunPolicy ?? 'skip'
            }
        }
    },
    afterFire({ task, currentDate, firedAt }) {
        const expression = (
            task.params?.expression as string | undefined
        )?.trim()
        if (!expression) {
            throw new Error('Cron expression is required')
        }

        return {
            enabled: true,
            nextFireAt: new Date(
                CronExpressionParser.parse(expression, {
                    currentDate: new Date(
                        Math.max(
                            currentDate?.valueOf() ?? 0,
                            firedAt?.valueOf() ?? 0,
                            Date.now()
                        )
                    )
                })
                    .next()
                    .getTime()
            )
        }
    },
    reschedule({ task, after }) {
        const expression = (
            task.params?.expression as string | undefined
        )?.trim()
        if (!expression) {
            throw new Error('Cron expression is required')
        }

        return {
            enabled: true,
            nextFireAt: new Date(
                CronExpressionParser.parse(expression, {
                    currentDate: after
                })
                    .next()
                    .getTime()
            )
        }
    }
}
