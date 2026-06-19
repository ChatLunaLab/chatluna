import type { UsageMetadata } from '@langchain/core/messages'
import type { Tiktoken } from 'js-tiktoken/lite'
import type { Context } from 'koishi'
import { logger } from 'koishi-plugin-chatluna'
import { usageSourceFromStack } from 'koishi-plugin-chatluna/utils/usage_source'
import { getEncoding } from '../utils/tiktoken'

export function createModelUsageReporter(
    ctx: Context,
    platform: string,
    model: string,
    stack?: string
): ModelUsageReporter {
    const report: ModelUsageReporter = async (usage) => {
        const limit = Error.stackTraceLimit
        Error.stackTraceLimit = Math.max(limit, 50)
        const currentStack = new Error().stack
        Error.stackTraceLimit = limit
        const source = usageSourceFromStack(currentStack)
        const fallback =
            source === 'chatluna' || source === 'unknown'
                ? usageSourceFromStack(stack)
                : source

        const payload: ModelUsagePayload = {
            ...usage,
            source: fallback === 'unknown' ? source : fallback,
            platform: usage.platform ?? platform,
            model: usage.model ?? model,
            usageMetadata: usage.usageMetadata ?? {
                input_tokens: 0,
                output_tokens: 0,
                total_tokens: 0
            },
            estimated: usage.estimated ?? false,
            success: usage.success ?? true,
            createdAt: usage.createdAt ?? new Date()
        }
        try {
            await ctx.root.parallel('chatluna/model-usage', payload)
        } catch (e) {
            ctx.logger.error(e)
        }
    }
    return report
}

let encoder: Tiktoken | null = null
let warmup: Promise<void> | null = null
let failed = false

export function warmupTokenEncoder(): Promise<void> {
    if (encoder != null || failed) return Promise.resolve()
    if (warmup != null) return warmup
    warmup = getEncoding('cl100k_base')
        .then((e) => {
            encoder = e
        })
        .catch((e) => {
            failed = true
            logger.warn('tiktoken init failed; falling back to heuristic', e)
        })
        .finally(() => {
            warmup = null
        })
    return warmup
}

export async function estimateTextTokens(input: string | string[]) {
    const text = Array.isArray(input) ? input.join('\n') : input
    if (encoder == null && !failed) await warmupTokenEncoder()

    if (encoder != null) {
        try {
            return encoder.encode(text).length
        } catch {}
    }

    let count = 0
    for (const char of text) {
        count += char.charCodeAt(0) <= 0x7f ? 0.25 : 2 / 3
    }
    return Math.ceil(count)
}

declare module 'koishi' {
    interface Events {
        'chatluna/model-usage'(payload: ModelUsagePayload): Promise<void>
    }
}

export type ModelUsageCallType = 'llm' | 'embeddings' | 'reranker'

export interface ModelUsageContext {
    chatPlatform?: string
    conversationId?: string
    requestId?: string
    userId?: string
    guildId?: string
}

export interface ModelUsagePayload {
    source: string
    callType: ModelUsageCallType
    platform: string
    model: string
    usageMetadata: UsageMetadata
    estimated: boolean
    success: boolean
    createdAt: Date
    timing?: ModelUsageTiming
    context?: ModelUsageContext
}

export interface ModelUsageTiming {
    ttftMs?: number
    totalMs?: number
    tps?: number
}

export type ModelUsageInput = Omit<
    ModelUsagePayload,
    | 'source'
    | 'createdAt'
    | 'platform'
    | 'model'
    | 'usageMetadata'
    | 'estimated'
    | 'success'
> & {
    createdAt?: Date
    platform?: string
    model?: string
    usageMetadata?: UsageMetadata
    estimated?: boolean
    success?: boolean
}

export interface ModelUsageReporter {
    (usage: ModelUsageInput): Promise<void> | void
}

export interface EmbeddingsUsageResult {
    data: number[] | number[][]
    usage?: UsageMetadata
}

export interface UsageContext {
    source: string
    chatPlatform?: string
    conversationId?: string
    requestId?: string
    userId?: string
    guildId?: string
}

export type EmbeddingsResult = number[] | number[][] | EmbeddingsUsageResult

export interface RerankerUsageResult {
    results: RerankerResult[]
    usage?: UsageMetadata
}

export interface RerankerResult {
    index: number
    relevanceScore: number
}
