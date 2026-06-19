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

type MetricsCarrier = { [chatlunaMetricsKey]?: ChatLunaInvocationMetrics }

export function attachInvocationMetrics(
    chunk: ChatGeneration | ChatGenerationChunk,
    metrics: ChatLunaInvocationMetrics
): void {
    chunk.generationInfo = {
        ...chunk.generationInfo,
        [chatlunaMetricsKey]: metrics
    }
    const message = chunk.message as AIMessageChunk | undefined
    if (message != null) {
        message.response_metadata = {
            ...message.response_metadata,
            [chatlunaMetricsKey]: metrics
        }
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

export function createModelUsageTiming(
    start: number,
    firstAt?: number,
    usage?: UsageMetadata
): ModelUsageTiming {
    const totalMs = Math.max(0, Date.now() - start)
    const ttftMs = firstAt == null ? totalMs : Math.max(0, firstAt - start)
    const genMs = Math.max(0, totalMs - ttftMs)
    // TPS denominator excludes the first-token latency (prefill); only the
    // post-TTFT generation span counts as output time. Non-streaming calls
    // pass no firstAt, so the full elapsed time is used.
    const tpsMs = firstAt == null ? totalMs : genMs
    // TPS numerator covers the full generation throughput: visible completion
    // output plus reasoning tokens.
    const tpsTokens = usage?.output_tokens ?? 0
    return {
        ttftMs,
        totalMs,
        tps: Math.min(tpsMs > 0 ? (tpsTokens * 1000) / tpsMs : 0, tpsTokens)
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

/**
 * Collects timing + usage across a streaming completion and attaches a single
 * ChatLunaInvocationMetrics payload to the trailing chunk. Encapsulates the
 * mutable state and BaseMessage->AIMessageChunk casts out of completionStream.
 */
export class StreamMetricsTracker {
    private readonly start = Date.now()
    private firstAt?: number
    private usage?: UsageMetadata

    observe(chunk: ChatGenerationChunk): void {
        const message = chunk.message as AIMessageChunk | undefined
        if (message?.usage_metadata != null) {
            this.usage = message.usage_metadata
        }
        if (this.firstAt == null && hasResponseChunk(chunk)) {
            this.firstAt = Date.now()
        }
    }

    attachTo(chunk: ChatGenerationChunk): ChatGenerationChunk {
        attachInvocationMetrics(chunk, {
            usageMetadata: this.usage,
            timing: createModelUsageTiming(this.start, this.firstAt, this.usage)
        })
        return chunk
    }
}
