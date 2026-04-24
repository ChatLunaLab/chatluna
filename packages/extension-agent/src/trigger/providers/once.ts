import { z } from 'zod'
import type { TriggerProvider } from '../../types'

export const onceTriggerProvider: TriggerProvider = {
    kind: 'once',
    name: '一次性定时',
    description: '在指定时间触发一次，触发后自动禁用。',
    scheduled: true,
    needsMessage: true,
    schema: z.object({
        fireAt: z
            .string()
            .describe(
                '触发时间，ISO 8601 字符串，例如 2026-04-23T09:00:00+08:00。'
            )
    }),
    prepare({ input }) {
        const raw =
            (input.params?.fireAt as string | undefined)?.trim() ??
            (typeof input.nextFireAt === 'string'
                ? input.nextFireAt
                : input.nextFireAt instanceof Date
                  ? input.nextFireAt.toISOString()
                  : undefined)
        if (!raw) {
            throw new Error('fireAt is required for once trigger')
        }

        const date = new Date(raw)
        if (Number.isNaN(date.valueOf())) {
            throw new Error(`Invalid fireAt value: ${raw}`)
        }

        if (date.valueOf() <= Date.now()) {
            throw new Error('fireAt must be in the future')
        }

        return {
            nextFireAt: date,
            params: {
                ...input.params,
                fireAt: date.toISOString()
            }
        }
    }
}
