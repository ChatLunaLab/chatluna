import { AIMessageChunk } from '@langchain/core/messages'
import type { UsageMetadata } from '@langchain/core/messages'
import { ChatGeneration, ChatGenerationChunk } from '@langchain/core/outputs'
import type { ModelUsageTiming } from 'koishi-plugin-chatluna/llm-core/platform/usage'

/**
 * Typed carrier for ChatLuna invocation metrics (usage + timing). Attached to
 * generation results by requesters and read by the model for reporting. The
 * raw key is encapsulated by attachInvocationMetrics/readInvocationMetrics so
 * adapters never touch it directly.
 */
export interface ChatLunaInvocationMetrics {
    usageMetadata?: UsageMetadata
    timing?: ModelUsageTiming
}

const chatlunaMetricsKey = 'chatluna_invocation_metrics'
const STREAM_METADATA_SNAPSHOTS = [
    'reasoning_time',
    'output_tokens',
    'total_tokens',
    'totalMs',
    'tps'
] as const

type MetricsCarrier = { [chatlunaMetricsKey]?: ChatLunaInvocationMetrics }

export function attachInvocationMetrics(
    chunk: ChatGeneration | ChatGenerationChunk,
    metrics: ChatLunaInvocationMetrics
): void {
    chunk.generationInfo = {
        ...chunk.generationInfo,
        [chatlunaMetricsKey]: metrics
    }
}

export function readInvocationMetrics(
    chunk?: ChatGeneration
): ChatLunaInvocationMetrics {
    const message = chunk?.message as AIMessageChunk | undefined
    const info = chunk?.generationInfo as MetricsCarrier | undefined
    const metadata = message?.response_metadata as MetricsCarrier | undefined
    const metrics = info?.[chatlunaMetricsKey] ?? metadata?.[chatlunaMetricsKey]
    return {
        usageMetadata: metrics?.usageMetadata ?? message?.usage_metadata,
        timing: metrics?.timing
    }
}

export const MIN_LATENCY_MS = 10

export function createModelUsageTiming(
    start: number,
    firstAt?: number,
    usage?: UsageMetadata
): ModelUsageTiming {
    const totalMs = Math.max(Date.now() - start, MIN_LATENCY_MS)
    const outputTokens =
        usage == null
            ? undefined
            : usage.output_tokens + (usage.output_token_details?.reasoning ?? 0)
    if (firstAt == null) {
        return {
            totalMs,
            tps:
                outputTokens == null
                    ? undefined
                    : (outputTokens * 1000) / totalMs
        }
    }
    const ttftMs = Math.max(firstAt - start, MIN_LATENCY_MS)
    return {
        ttftMs,
        totalMs,
        tps: outputTokens == null ? undefined : (outputTokens * 1000) / totalMs
    }
}

function hasResponseChunk(chunk: ChatGenerationChunk) {
    const message = chunk.message as AIMessageChunk | undefined
    const content = message?.content
    const kwargs = message?.additional_kwargs

    return (
        chunk.text.length > 0 ||
        (typeof content === 'string'
            ? content.trim().length > 0
            : Array.isArray(content) && content.length > 0) ||
        (message?.tool_call_chunks?.length ?? 0) > 0 ||
        (message?.tool_calls?.length ?? 0) > 0 ||
        (message?.invalid_tool_calls?.length ?? 0) > 0 ||
        ((kwargs?.tool_calls as unknown[] | undefined)?.length ?? 0) > 0 ||
        kwargs?.function_call != null ||
        kwargs?.thought_data != null
    )
}

function snapshotKeys(
    target: Record<string, unknown> | null | undefined,
    out: Record<string, unknown>
): Record<string, unknown> | undefined {
    if (target == null) return undefined
    const keys = STREAM_METADATA_SNAPSHOTS.filter((key) =>
        Object.hasOwn(target, key)
    )
    if (keys.length === 0) return undefined
    const copy = { ...target }
    for (const key of keys) {
        out[key] = copy[key]
        delete copy[key]
    }
    return copy
}

/**
 * Collects timing + usage across a streaming completion and attaches a single
 * ChatLunaInvocationMetrics payload to the trailing chunk. Encapsulates the
 * mutable state and BaseMessage->AIMessageChunk casts out of completionStream.
 */
export class StreamMetricsTracker {
    private readonly start = Date.now()
    private firstAt?: number
    private usage?: UsageMetadata
    private readonly kwargs: Record<string, unknown> = {}
    private readonly metadata: Record<string, unknown> = {}
    private readonly info: Record<string, unknown> = {}

    observe(chunk: ChatGenerationChunk): void {
        const message = chunk.message as AIMessageChunk
        if (message.usage_metadata != null) {
            this.usage = message.usage_metadata
        }
        const kwargs = snapshotKeys(message.additional_kwargs, this.kwargs)
        if (kwargs) message.additional_kwargs = kwargs
        const metadata = snapshotKeys(message.response_metadata, this.metadata)
        if (metadata) message.response_metadata = metadata
        const info = snapshotKeys(chunk.generationInfo, this.info)
        if (info) chunk.generationInfo = info
        if (this.firstAt == null && hasResponseChunk(chunk)) {
            this.firstAt = Date.now()
        }
    }

    attachTo(chunk: ChatGenerationChunk): ChatGenerationChunk {
        chunk.message.additional_kwargs = {
            ...chunk.message.additional_kwargs,
            ...this.kwargs
        }
        chunk.message.response_metadata = {
            ...chunk.message.response_metadata,
            ...this.metadata
        }
        chunk.generationInfo = {
            ...chunk.generationInfo,
            ...this.info
        }
        attachInvocationMetrics(chunk, {
            usageMetadata: this.usage,
            timing: createModelUsageTiming(this.start, this.firstAt, this.usage)
        })
        return chunk
    }
}
