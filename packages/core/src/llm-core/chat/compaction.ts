import {
    AIMessage,
    BaseMessage,
    HumanMessage,
    ToolMessage
} from '@langchain/core/messages'
import { randomUUID } from 'crypto'
import { logger } from 'koishi-plugin-chatluna'
import type { ChatLunaChatModel } from '../platform/model'
import { ModelCapabilities } from 'koishi-plugin-chatluna/llm-core/platform/types'
import { summarizeContext } from '../chain/compaction'
import { renderContext } from './snap'

export type CompactionMode = 'soft' | 'snap'

export interface CompactionMetadata {
    mode: CompactionMode
    source?: string
    through?: string
}

export interface CompactionOptions {
    messages: BaseMessage[]
    model: ChatLunaChatModel
    conversationId?: string
    maxContextWindow?: number
    autoCompactWindow?: number | 'auto'
    maxTokens?: number
    reservedTokens?: number
    force?: boolean
    mode?: CompactionMode
    signal?: AbortSignal
    instruction?: string
}

export interface CompactionResult {
    inputTokens: number
    outputTokens: number
    reducedTokens: number
    reducedPercent: number
    compressed: boolean
    originalMessageCount: number
    remainingMessageCount: number
    messages?: BaseMessage[]
    summary?: HumanMessage
    removed?: BaseMessage[]
}

export function contextBudget(
    model: ChatLunaChatModel,
    opts: Pick<
        CompactionOptions,
        'maxContextWindow' | 'autoCompactWindow' | 'maxTokens'
    >
): { limit: number; threshold: number; target: number; output: number } {
    const invocation = model.invocationParams()
    const capacity = model.getModelMaxContextSize()
    const configured = opts.maxContextWindow ?? invocation.maxContextWindow
    const limit = Math.floor(
        configured > 0 ? Math.min(configured, capacity) : capacity
    )
    if (!Number.isFinite(limit) || limit <= 0) {
        throw new Error('Model context window is unavailable')
    }
    const configuredOutput = opts.maxTokens ?? invocation.maxTokens
    const automaticReserve = Math.min(
        Math.floor(limit / 2),
        Math.max(Math.floor(limit * 0.15), 16384)
    )
    const output =
        configuredOutput > 0 ? Math.ceil(configuredOutput) : automaticReserve
    const usable = limit - output
    if (usable <= 0)
        throw new Error('Output reserve exhausts the context window')
    const configuredThreshold = opts.autoCompactWindow
    const threshold = Math.floor(
        typeof configuredThreshold === 'number' && configuredThreshold > 0
            ? Math.min(configuredThreshold, usable)
            : Math.min(usable, limit - automaticReserve)
    )
    return { limit, threshold, target: Math.floor(threshold * 0.8), output }
}

export async function compactContext(
    opts: CompactionOptions
): Promise<CompactionResult> {
    const { messages, model } = opts
    opts.signal?.throwIfAborted()
    const budget = contextBudget(model, opts)
    const reserved = Math.max(0, opts.reservedTokens ?? 0)
    const counts: number[] = []
    for (const message of messages) {
        opts.signal?.throwIfAborted()
        counts.push(await model.countMessageTokens(message))
    }
    const inputTokens = counts.reduce((sum, tokens) => sum + tokens, 0)
    const unchanged: CompactionResult = {
        inputTokens,
        outputTokens: inputTokens,
        reducedTokens: 0,
        reducedPercent: 0,
        compressed: false,
        originalMessageCount: messages.length,
        remainingMessageCount: messages.length
    }
    const vision =
        model.modelInfo.capabilities?.includes(ModelCapabilities.ImageInput) ??
        false
    if (opts.mode === 'snap' && !vision) {
        throw new Error('Snap compaction requires an image-capable model')
    }
    const conversionIndex = messages.findIndex(
        (message) =>
            (
                message.response_metadata.compaction as
                    CompactionMetadata | undefined
            )?.mode === 'snap' && !vision
    )
    if (
        !opts.force &&
        conversionIndex < 0 &&
        inputTokens + reserved <= budget.threshold
    ) {
        return unchanged
    }
    if (messages.length === 0) return unchanged
    const available = budget.target - reserved
    if (available <= 8)
        throw new Error(
            'Reserved prompt tokens leave no context compaction budget'
        )

    // A boundary may not separate an assistant tool call from any of its results.
    // Assistant boundaries permit compaction within unusually long tool turns.
    const boundaries: number[] = []
    const pending = new Set<string>()
    let pendingFunction: string | undefined
    for (let index = 0; index < messages.length; index++) {
        const message = messages[index]
        const type = message.getType()
        if (
            index > 0 &&
            pending.size === 0 &&
            pendingFunction == null &&
            (type === 'human' || type === 'ai')
        ) {
            boundaries.push(index)
        }
        const normalizedCalls = (message as AIMessage).tool_calls
        const calls = normalizedCalls?.length
            ? normalizedCalls
            : (message.additional_kwargs.tool_calls as
                  { id?: string }[] | undefined)
        if (type === 'ai' && calls?.length) {
            for (const call of calls) {
                pending.add(call.id ?? `unidentified-tool-call-${index}`)
            }
        }
        if (type === 'ai' && message.additional_kwargs.function_call) {
            pendingFunction =
                message.additional_kwargs.function_call.name ??
                `unidentified-function-call-${index}`
        }
        if (type === 'function' && message.name === pendingFunction) {
            pendingFunction = undefined
        }
        if (type === 'tool') {
            const id = (message as ToolMessage).tool_call_id
            if (id) pending.delete(id)
        }
    }
    // A persisted summary is also an independent group, including old plain summaries.
    if (
        messages.length > 1 &&
        (messages[0].response_metadata.compaction ||
            messages[0].name === 'infinite_context') &&
        !boundaries.includes(1) &&
        messages[1].getType() !== 'tool' &&
        messages[1].getType() !== 'function'
    ) {
        boundaries.unshift(1)
    }
    const summaryAllowance = Math.max(
        1,
        Math.min(2048, Math.floor(available / 4))
    )
    let boundary = 0
    let retainedTokens = inputTokens
    for (const candidate of boundaries) {
        // Re-rendering only an existing summary cannot reduce its token cost.
        if (
            candidate === 1 &&
            messages[0].response_metadata.compaction &&
            conversionIndex < 0
        )
            continue
        const tailTokens = counts
            .slice(candidate)
            .reduce((sum, tokens) => sum + tokens, 0)
        if (tailTokens + 8 < available && candidate > conversionIndex) {
            boundary = candidate
            retainedTokens = tailTokens
            if (tailTokens + summaryAllowance + 8 <= available) break
        }
    }
    if (boundary === 0) {
        // Conversion of a lone snap summary has no ordinary turn to retain.
        if (conversionIndex === 0 && messages.length === 1) {
            boundary = 1
            retainedTokens = 0
        } else {
            throw new Error(
                'Latest complete message group cannot fit the context compaction budget'
            )
        }
    }
    const removed = messages.slice(0, boundary)
    const retained = messages.slice(boundary)
    const source = serializeTranscript(removed)
    const maxSummaryTokens = Math.min(
        summaryAllowance,
        available - retainedTokens - 8
    )
    if (maxSummaryTokens <= 0)
        throw new Error('No token budget remains for a context summary')
    let mode: CompactionMode = 'soft'
    let summary: HumanMessage | undefined
    let summaryTokens = 0
    if (vision && opts.mode !== 'soft') {
        try {
            const rendered = await renderContext(source, {
                maxTokens: available - retainedTokens - 8,
                model: model.modelName,
                signal: opts.signal
            })
            if (rendered) {
                const candidate = new HumanMessage({
                    content: rendered.content,
                    name: 'context_compaction',
                    id: randomUUID()
                })
                const tokens = await model.countMessageTokens(candidate)
                if (
                    tokens + retainedTokens < inputTokens &&
                    tokens + retainedTokens <= available
                ) {
                    mode = 'snap'
                    summary = candidate
                    summaryTokens = tokens
                }
            }
            if (!summary && opts.mode === 'snap') {
                throw new Error(
                    'Snap rendering cannot reduce this context within its token budget'
                )
            }
        } catch (error) {
            opts.signal?.throwIfAborted()
            if (opts.mode === 'snap') throw error
            logger.warn(
                'Snap rendering unavailable; falling back to soft compaction: %s',
                error
            )
        }
    }
    if (!summary) {
        const text = await summarizeContext(model, source, {
            limit: budget.limit,
            maxTokens: maxSummaryTokens,
            conversationId: opts.conversationId,
            signal: opts.signal,
            instruction: opts.instruction
        })
        summary = new HumanMessage({
            content: text,
            name: 'context_compaction',
            id: randomUUID()
        })
        summaryTokens = await model.countMessageTokens(summary)
    }
    summary.response_metadata.compaction = {
        mode,
        ...(mode === 'snap' ? { source } : {})
    } satisfies CompactionMetadata
    const outputTokens = summaryTokens + retainedTokens
    // A text-model conversion may cost more than the old image representation;
    // it must still reduce its recoverable source and fit the new model's budget.
    const comparisonTokens =
        conversionIndex >= 0
            ? retainedTokens + (await model.getNumTokens(source))
            : inputTokens
    if (
        outputTokens >= comparisonTokens ||
        outputTokens + reserved > budget.target
    ) {
        throw new Error(
            'Context compaction made no progress or remains over budget'
        )
    }
    opts.signal?.throwIfAborted()
    const reducedTokens = inputTokens - outputTokens
    return {
        inputTokens,
        outputTokens,
        reducedTokens,
        reducedPercent:
            inputTokens > 0 ? (reducedTokens / inputTokens) * 100 : 0,
        compressed: true,
        originalMessageCount: messages.length,
        remainingMessageCount: retained.length + 1,
        messages: [summary, ...retained],
        summary,
        removed
    }
}

function serializeTranscript(messages: BaseMessage[]): string {
    return messages
        .map((message) => {
            const metadata = message.response_metadata.compaction as
                CompactionMetadata | undefined
            if (metadata?.mode === 'snap') {
                if (!metadata.source)
                    throw new Error('Snap summary has no recoverable source')
                return metadata.source
            }
            const normalizedCalls = (message as AIMessage).tool_calls
            const calls = normalizedCalls?.length
                ? normalizedCalls
                : message.additional_kwargs.tool_calls
            const entry = {
                role: message.getType(),
                name: message.name,
                id: message.id,
                tool_call_id:
                    message instanceof ToolMessage
                        ? message.tool_call_id
                        : undefined,
                tool_calls: calls,
                function_call: message.additional_kwargs.function_call,
                content: message.content
            }
            return JSON.stringify(
                entry,
                function (this: Record<string, unknown>, key, value) {
                    if (typeof value === 'string') {
                        if (
                            key === 'b64_json' ||
                            (key === 'data' &&
                                (this.type === 'base64' ||
                                    this.source_type === 'base64' ||
                                    this.format ||
                                    this.mime_type))
                        ) {
                            return '[embedded media data]'
                        }
                        return value.replace(
                            /data:([^;,\s]+)(?:;[^,\s]*)?,[^\s"')]+/g,
                            '[embedded media: $1]'
                        )
                    }
                    return value
                }
            )
        })
        .join('\n\n')
}
