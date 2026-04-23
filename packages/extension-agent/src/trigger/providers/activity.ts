import { z } from 'zod'
import type { TriggerProvider } from '../../types'

const activitySchema = z.object({
    threshold: z.coerce
        .number()
        .int()
        .min(1)
        .default(4)
        .describe('最近消息数量达到该值后触发。'),
    windowMs: z.coerce
        .number()
        .int()
        .min(1000)
        .default(10 * 60 * 1000)
        .describe('统计消息的时间窗口，单位毫秒。'),
    cooldownMs: z.coerce
        .number()
        .int()
        .min(1000)
        .default(30 * 60 * 1000)
        .describe('同一任务再次触发前的最小冷却时间，单位毫秒。')
})

export const activityTriggerProvider: TriggerProvider = {
    kind: 'activity',
    name: '活跃度',
    description: '同一绑定内最近消息达到阈值后，被动唤醒代理。',
    passive: true,
    needsMessage: false,
    schema: activitySchema,
    prepare({ input }) {
        const parsed = activitySchema.parse(input.params ?? {})
        return {
            nextFireAt: null,
            params: {
                ...input.params,
                ...parsed
            }
        }
    },
    match({ task, content, activityCount }) {
        const parsed = activitySchema.safeParse(task.params ?? {})
        const threshold = parsed.success ? parsed.data.threshold : 4
        if (activityCount < threshold) {
            return null
        }

        return {
            message: task.wakeupTemplate.message ?? content,
            detail: {
                activityCount,
                threshold
            }
        }
    },
    afterFire() {
        return {
            enabled: true,
            nextFireAt: null
        }
    }
}
