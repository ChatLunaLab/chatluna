import {
    BaseMessage,
    HumanMessage,
    mapStoredMessageToChatMessage
} from '@langchain/core/messages'
import { logger } from 'koishi-plugin-chatluna'
import { KoishiChatMessageHistory } from 'koishi-plugin-chatluna/llm-core/memory/message'
import { ChatLunaChatModel } from 'koishi-plugin-chatluna/llm-core/platform/model'
import { PresetTemplate } from 'koishi-plugin-chatluna/llm-core/prompt'
import { getMessageContent } from 'koishi-plugin-chatluna/utils/string'
import { isChatLunaUserMessage } from 'koishi-plugin-chatluna/utils/langchain'
import { countMessagesTokens } from 'koishi-plugin-chatluna/llm-core/utils/count_tokens'
import { compressChunk } from '../chain/infinite_context_chain'
import type { ChatLunaMessageMeta } from '../../types'
import { ComputedRef } from '@vue/reactivity'

export interface CompressContextResult {
    inputTokens: number
    outputTokens: number
    reducedTokens: number
    reducedPercent: number
    compressed: boolean
    originalMessageCount: number
    remainingMessageCount: number
    messages?: BaseMessage[]
}

export interface CompressContextOptions {
    chatHistory: KoishiChatMessageHistory
    model: ChatLunaChatModel
    conversationId: string
    preset?: ComputedRef<PresetTemplate>
    threshold?: number
    force?: boolean
    signal?: AbortSignal
}

/**
 * Compress chat history when token usage exceeds threshold.
 * Produces structured output: [summary message, ...recent messages].
 */
export async function compressIfNeeded(
    opts: CompressContextOptions
): Promise<CompressContextResult> {
    const { chatHistory, model, conversationId, force } = opts
    const messages = await chatHistory.getMessages()

    if (messages.length === 0) return emptyResult()

    // Step 1: compact expired tool results
    const compacted = compactExpiredToolResults(messages)

    // Step 2: count tokens
    const tokenCounter = (text: string) => model.getNumTokens(text)
    const inputTokens = await countMessagesTokens(compacted, tokenCounter)

    const noCompressResult = (): CompressContextResult => ({
        ...emptyResult(),
        inputTokens,
        originalMessageCount: messages.length,
        remainingMessageCount: compacted.length,
        messages: compacted !== messages ? compacted : undefined
    })

    // Step 3: determine if compression is needed
    if (!force) {
        const invocation = model.invocationParams()
        const maxTokenLimit =
            invocation.maxTokenLimit && invocation.maxTokenLimit > 0
                ? invocation.maxTokenLimit
                : model.getModelMaxContextSize()

        if (!maxTokenLimit || maxTokenLimit <= 0) return noCompressResult()

        const presetMessages = Array.isArray(opts.preset?.value?.messages)
            ? (opts.preset.value.messages as BaseMessage[])
            : []
        const presetTokens = await countMessagesTokens(
            presetMessages,
            tokenCounter
        )
        const threshold = Math.floor(maxTokenLimit * (opts.threshold ?? 0.85))

        if (inputTokens + presetTokens <= threshold) return noCompressResult()

        logger.info(
            '[InfiniteContext] Start compression: history=%d tokens, total=%d, threshold=%d',
            inputTokens,
            inputTokens + presetTokens,
            threshold
        )
    } else {
        logger.info(
            '[InfiniteContext] Manual compression: history=%d tokens',
            inputTokens
        )
    }

    // Step 4: split messages
    const { toCompress, toKeep } = splitMessages(compacted)
    if (toCompress.length === 0) return noCompressResult()

    // Step 5: generate summary
    const transcript = formatTranscript(toCompress)
    if (!transcript.trim()) return noCompressResult()

    const summary = await compressChunk(
        model,
        transcript,
        conversationId,
        opts.signal
    )
    if (!summary?.text.trim()) return noCompressResult()

    // Step 6: build result
    const summaryMessage = new HumanMessage({
        content: summary.text.trim(),
        name: 'infinite_context',
        additional_kwargs: { source: 'infinite-context' }
    })

    const resultMessages = [summaryMessage, ...toKeep]
    const outputTokens = await countMessagesTokens(resultMessages, tokenCounter)
    const reducedTokens = inputTokens - outputTokens
    const reducedPercent =
        inputTokens > 0 ? (reducedTokens / inputTokens) * 100 : 0

    logger.info(
        '[InfiniteContext] Compressed: %d → %d tokens (-%d, %.2f%%), kept %d recent messages',
        inputTokens,
        outputTokens,
        reducedTokens,
        reducedPercent,
        toKeep.length
    )

    return {
        inputTokens,
        outputTokens,
        reducedTokens,
        reducedPercent,
        compressed: true,
        originalMessageCount: messages.length,
        remainingMessageCount: resultMessages.length,
        messages: resultMessages
    }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function emptyResult(): CompressContextResult {
    return {
        inputTokens: 0,
        outputTokens: 0,
        reducedTokens: 0,
        reducedPercent: 0,
        compressed: false,
        originalMessageCount: 0,
        remainingMessageCount: 0
    }
}

/**
 * Replace expired (>1h) tool result content with a placeholder.
 */
function compactExpiredToolResults(messages: BaseMessage[]): BaseMessage[] {
    const placeholder =
        'This tool result expired after 1 hour, so the original output was removed.'
    let changed = false

    const result = messages.map((msg) => {
        if (msg.getType() !== 'tool') return msg
        const meta = msg.response_metadata?.chatluna as
            | ChatLunaMessageMeta
            | undefined
        if (!meta?.createdAt) return msg
        if (Date.now() - new Date(meta.createdAt).getTime() < 3600000)
            return msg
        if (getMessageContent(msg.content).trim() === placeholder) return msg

        changed = true
        const cloned = msg.toDict()
        cloned.data.content = placeholder
        return mapStoredMessageToChatMessage(cloned)
    })

    return changed ? result : messages
}

/**
 * Split messages into [toCompress, toKeep].
 * Keep the most recent complete conversation rounds.
 * A round starts at a user message (HumanMessage or ChatLuna user message).
 */
function splitMessages(messages: BaseMessage[]): {
    toCompress: BaseMessage[]
    toKeep: BaseMessage[]
} {
    // Build rounds from the end
    const rounds: BaseMessage[][] = []
    let current: BaseMessage[] = []

    for (let i = messages.length - 1; i >= 0; i--) {
        const msg = messages[i]
        current.unshift(msg)

        const isRoundStart =
            isChatLunaUserMessage(msg) || msg.getType() === 'human'

        if (isRoundStart && i > 0) {
            rounds.unshift(current)
            current = []
        }
    }

    if (current.length > 0) {
        rounds.unshift(current)
    }

    // Keep at least the last round, at most last 3 rounds
    const keepCount = Math.min(Math.max(1, Math.ceil(rounds.length * 0.3)), 3)
    const splitIdx = rounds.length - keepCount

    const toCompress = rounds.slice(0, splitIdx).flat()
    const toKeep = rounds.slice(splitIdx).flat()

    return { toCompress, toKeep }
}

/**
 * Format messages into a transcript string for the LLM summarizer.
 */
function formatTranscript(messages: BaseMessage[]): string {
    return messages
        .map((msg) => {
            const role = msg.getType().toUpperCase()
            const name = msg.name ? ` (${msg.name})` : ''
            const content = getMessageContent(msg.content).trim()

            const toolCalls = msg['tool_calls'] as
                | { name: string; args: unknown }[]
                | undefined
            const toolInfo =
                toolCalls?.length > 0
                    ? '\nTool calls: ' +
                      toolCalls
                          .map((tc) => {
                              const args = JSON.stringify(tc.args)
                              return `${tc.name}(${args.length > 200 ? args.slice(0, 200) + '...' : args})`
                          })
                          .join(', ')
                    : ''

            const callId = msg['tool_call_id'] as string | undefined
            const idInfo = callId ? ` [call_id: ${callId}]` : ''

            return `[${role}${name}${idInfo}]\n${content || '(empty)'}${toolInfo}`
        })
        .join('\n\n---\n\n')
}
