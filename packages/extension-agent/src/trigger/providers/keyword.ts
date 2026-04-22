import { z } from 'zod'
import type { TriggerProvider } from '../../types'

export const keywordTriggerProvider: TriggerProvider = {
    kind: 'keyword',
    name: '关键词',
    description: '当消息文本包含任一配置关键词时，被动唤醒代理。',
    passive: true,
    needsMessage: false,
    schema: z.object({
        keywords: z
            .array(z.string().min(1))
            .min(1)
            .describe('用于匹配输入消息的关键词列表。'),
        caseSensitive: z.boolean().default(false).describe('是否区分大小写。'),
        cooldownMs: z
            .number()
            .int()
            .min(1000)
            .default(5 * 60 * 1000)
            .describe('同一任务再次触发前的最小冷却时间，单位毫秒。')
    }),
    prepare({ input }) {
        const keywords = Array.isArray(input.params?.keywords)
            ? input.params.keywords
                  .map((item) => String(item).trim())
                  .filter((item) => item.length > 0)
            : []

        if (keywords.length < 1) {
            throw new Error('At least one keyword is required')
        }

        return {
            nextFireAt: null,
            params: {
                ...input.params,
                keywords,
                caseSensitive: Boolean(input.params?.caseSensitive),
                cooldownMs: Number(input.params?.cooldownMs ?? 5 * 60 * 1000)
            }
        }
    },
    match({ task, content }) {
        const keywords = Array.isArray(task.params?.keywords)
            ? task.params.keywords.map((item) => String(item))
            : []
        if (keywords.length < 1) {
            return null
        }

        const caseSensitive = Boolean(task.params?.caseSensitive)
        const text = caseSensitive ? content : content.toLowerCase()
        const matched = keywords.find((item) =>
            text.includes(caseSensitive ? item : item.toLowerCase())
        )
        if (matched == null) {
            return null
        }

        return {
            message: task.wakeupTemplate.message ?? content,
            detail: {
                keyword: matched
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
