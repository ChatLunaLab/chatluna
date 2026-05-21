import type { UsageMetadata } from '@langchain/core/messages'
import type { Tiktoken } from 'js-tiktoken/lite'
import { logger } from 'koishi-plugin-chatluna'
import { getEncoding } from '../utils/tiktoken'

export type ModelUsageCallType = 'llm' | 'embeddings' | 'reranker'

export interface ModelUsagePayload {
    source: string
    callType: ModelUsageCallType
    platform: string
    model: string
    inputTokens: number
    outputTokens: number
    totalTokens: number
    estimated: boolean
    createdAt: Date
    conversationId?: string
    requestId?: string
    userId?: string
    guildId?: string
}

export type ModelUsageInput = Omit<
    ModelUsagePayload,
    'source' | 'createdAt' | 'platform' | 'model'
> & {
    source?: string
    createdAt?: Date
    platform?: string
    model?: string
}

export type ModelUsageReporter = (
    usage: ModelUsageInput
) => Promise<void> | void

export interface UsageContext {
    source: string
    conversationId?: string
    requestId?: string
    userId?: string
    guildId?: string
}

declare module 'koishi' {
    interface Events {
        'chatluna/model-usage'(payload: ModelUsagePayload): Promise<void>
    }
}

export interface EmbeddingsUsageResult {
    data: number[] | number[][]
    usage?: UsageMetadata
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
