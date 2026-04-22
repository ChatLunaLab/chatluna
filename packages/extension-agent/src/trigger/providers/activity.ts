import { z } from 'zod'
import type { TriggerProvider } from '../../types'

export const activityTriggerProvider: TriggerProvider = {
    kind: 'activity',
    name: '活跃度',
    description: '同一绑定内最近消息达到阈值后，被动唤醒代理。',
    passive: true,
    needsMessage: false,
    schema: z.object({
        threshold: z
            .number()
            .int()
            .min(1)
            .default(4)
            .describe('最近消息数量达到该值后触发。'),
        windowMs: z
            .number()
            .int()
            .min(1000)
            .default(10 * 60 * 1000)
            .describe('统计消息的时间窗口，单位毫秒。'),
        cooldownMs: z
            .number()
            .int()
            .min(1000)
            .default(30 * 60 * 1000)
            .describe('同一任务再次触发前的最小冷却时间，单位毫秒。')
    }),
    prepare({ input }) {
        return {
            nextFireAt: null,
            params: {
                ...input.params,
                threshold: Number(input.params?.threshold ?? 4),
                windowMs: Number(input.params?.windowMs ?? 10 * 60 * 1000),
                cooldownMs: Number(input.params?.cooldownMs ?? 30 * 60 * 1000)
            }
        }
    },
    match({ task, content, activityCount }) {
        const threshold = Number(task.params?.threshold ?? 4)
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
