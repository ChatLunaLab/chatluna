import type { UsageMetadata } from '@langchain/core/messages'
import type { Tiktoken } from 'js-tiktoken/lite'
import type { Context } from 'koishi'
import { logger } from 'koishi-plugin-chatluna'
import { usageSourceFromStack } from 'koishi-plugin-chatluna/utils/usage_source'
import { getEncoding } from '../utils/tiktoken'

export function createModelUsageReporter(
    ctx: Context,
    platform: string,
    model: string
): ModelUsageReporter {
    return async (usage) => {
        const payload: ModelUsagePayload = {
            ...usage,
            source: usage.source ?? usageSourceFromStack(new Error().stack),
            platform: usage.platform ?? platform,
            model: usage.model ?? model,
            tokens: {
                input: usage.tokens?.input ?? 0,
                output: usage.tokens?.output ?? 0,
                total: usage.tokens?.total ?? 0,
                estimated: usage.tokens?.estimated ?? false,
                cacheRead: usage.tokens?.cacheRead ?? 0,
                cacheCreation: usage.tokens?.cacheCreation ?? 0
            },
            success: usage.success ?? true,
            createdAt: usage.createdAt ?? new Date()
        }
        try {
            await ctx.root.parallel('chatluna/model-usage', payload)
        } catch (e) {
            ctx.logger.error(e)
        }
    }
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

export interface ModelUsageTokens {
    input: number
    output: number
    total: number
    estimated: boolean
    cacheRead: number
    cacheCreation: number
}

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
    tokens: ModelUsageTokens
    success: boolean
    createdAt: Date
    context?: ModelUsageContext
}

export type ModelUsageInput = Omit<
    ModelUsagePayload,
    'source' | 'createdAt' | 'platform' | 'model' | 'tokens' | 'success'
> & {
    source?: string
    createdAt?: Date
    platform?: string
    model?: string
    tokens?: Partial<ModelUsageTokens>
    success?: boolean
}

export type ModelUsageReporter = (
    usage: ModelUsageInput
) => Promise<void> | void

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
