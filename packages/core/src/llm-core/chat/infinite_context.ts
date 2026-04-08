/* eslint-disable max-len */
import {
    BaseMessage,
    HumanMessage,
    mapStoredMessageToChatMessage
} from '@langchain/core/messages'
import { ComputedRef } from '@vue/reactivity'
import { logger } from 'koishi-plugin-chatluna'
import { ChatLunaLLMChainWrapper } from 'koishi-plugin-chatluna/llm-core/chain/base'
import { KoishiChatMessageHistory } from 'koishi-plugin-chatluna/llm-core/memory/message'
import { ChatLunaChatModel } from 'koishi-plugin-chatluna/llm-core/platform/model'
import { PresetTemplate } from 'koishi-plugin-chatluna/llm-core/prompt'
import { getMessageContent } from 'koishi-plugin-chatluna/utils/string'
import { ChatLunaInfiniteContextChain } from '../chain/infinite_context_chain'
import type { ChatLunaMessageMeta } from '../../services/conversation_types'

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

function formatTranscript(messages: BaseMessage[]) {
    return messages
        .map((message) => {
            const role = message.getType().toUpperCase()
            const name = message.name ? ` (${message.name})` : ''
            const content = getMessageContent(message.content).trim()
            return `[${role}${name}]\n${content || '(empty)'}`
        })
        .join('\n\n---\n\n')
}

export interface InfiniteContextManagerOptions {
    chatHistory: KoishiChatMessageHistory
    conversationId: string
    preset?: ComputedRef<PresetTemplate>
    threshold?: number
}

export class InfiniteContextManager {
    private _chain?: ChatLunaInfiniteContextChain

    constructor(private readonly options: InfiniteContextManagerOptions) {}

    async compressIfNeeded(
        wrapper: ChatLunaLLMChainWrapper,
        force = false
    ): Promise<CompressContextResult> {
        const model = wrapper.model

        if (!model) {
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

        const messages = await this.options.chatHistory.getMessages()

        if (messages.length === 0) {
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

        const inputTokens = await this._countMessagesTokens(model, messages)
        const expiredToolResultText =
            'This tool result expired after 1 hour, so the original output was removed.'
        let compactedCount = 0
        const compactedIndexes = new Set<number>()

        for (let idx = 0; idx < messages.length; idx++) {
            const message = messages[idx]

            if (message.getType() !== 'tool') {
                continue
            }

            const meta = message.response_metadata?.chatluna as
                | ChatLunaMessageMeta
                | undefined

            if (meta?.createdAt == null) {
                continue
            }

            if (Date.now() - new Date(meta.createdAt).getTime() < 3600000) {
                continue
            }

            if (
                getMessageContent(message.content).trim() ===
                expiredToolResultText
            ) {
                continue
            }

            compactedCount++
            compactedIndexes.add(idx)
        }

        const compactedMessages =
            compactedCount > 0
                ? messages.map((message, idx) => {
                      const cloned = mapStoredMessageToChatMessage(
                          message.toDict()
                      )

                      if (compactedIndexes.has(idx)) {
                          cloned.content = expiredToolResultText
                      }

                      return cloned
                  })
                : messages
        const nextMessages = compactedCount > 0 ? compactedMessages : messages
        const compactedTokens =
            compactedCount > 0
                ? await this._countMessagesTokens(model, nextMessages)
                : inputTokens
        let presetTokens = 0
        let threshold: number | undefined

        if (compactedCount > 0) {
            logger.info(
                '[InfiniteContext] Replaced %d expired tool results before compression',
                compactedCount
            )
        }

        if (!force) {
            const invocation = model.invocationParams()
            const maxTokenLimit =
                invocation.maxTokenLimit && invocation.maxTokenLimit > 0
                    ? invocation.maxTokenLimit
                    : model.getModelMaxContextSize()

            if (!maxTokenLimit || maxTokenLimit <= 0) {
                return {
                    inputTokens,
                    outputTokens: compactedTokens,
                    reducedTokens: inputTokens - compactedTokens,
                    reducedPercent:
                        inputTokens > 0
                            ? ((inputTokens - compactedTokens) / inputTokens) *
                              100
                            : 0,
                    compressed: false,
                    originalMessageCount: messages.length,
                    remainingMessageCount: nextMessages.length,
                    messages: compactedCount > 0 ? nextMessages : undefined
                }
            }

            const presetMessages = Array.isArray(
                this.options.preset?.value?.messages
            )
                ? (this.options.preset?.value.messages as BaseMessage[])
                : []

            presetTokens = await this._countMessagesTokens(
                model,
                presetMessages
            )
            threshold = Math.floor(
                maxTokenLimit * (this.options.threshold ?? 0.85)
            )

            if (compactedTokens + presetTokens <= threshold) {
                return {
                    inputTokens,
                    outputTokens: compactedTokens,
                    reducedTokens: inputTokens - compactedTokens,
                    reducedPercent:
                        inputTokens > 0
                            ? ((inputTokens - compactedTokens) / inputTokens) *
                              100
                            : 0,
                    compressed: false,
                    originalMessageCount: messages.length,
                    remainingMessageCount: nextMessages.length,
                    messages: compactedCount > 0 ? nextMessages : undefined
                }
            }

            logger.info(
                '[InfiniteContext] Start compression with history tokens: %d, total tokens: %d, threshold: %d',
                compactedTokens,
                compactedTokens + presetTokens,
                threshold
            )
        } else {
            logger.info(
                '[InfiniteContext] Start manual compression with history tokens: %d',
                compactedTokens
            )
        }

        const transcript = formatTranscript(nextMessages)

        if (!transcript.trim()) {
            return {
                inputTokens,
                outputTokens: compactedTokens,
                reducedTokens: inputTokens - compactedTokens,
                reducedPercent:
                    inputTokens > 0
                        ? ((inputTokens - compactedTokens) / inputTokens) * 100
                        : 0,
                compressed: false,
                originalMessageCount: messages.length,
                remainingMessageCount: nextMessages.length,
                messages: compactedCount > 0 ? nextMessages : undefined
            }
        }

        const summary = await this._ensureInfiniteContextChain(
            wrapper
        ).compressChunk({
            chunk: transcript,
            conversationId: this.options.conversationId
        })

        if (!summary?.text.trim()) {
            return {
                inputTokens,
                outputTokens: compactedTokens,
                reducedTokens: inputTokens - compactedTokens,
                reducedPercent:
                    inputTokens > 0
                        ? ((inputTokens - compactedTokens) / inputTokens) * 100
                        : 0,
                compressed: false,
                originalMessageCount: messages.length,
                remainingMessageCount: nextMessages.length,
                messages: compactedCount > 0 ? nextMessages : undefined
            }
        }

        const message = new HumanMessage({
            content: summary.text.trim(),
            name: 'infinite_context',
            additional_kwargs: {
                source: 'infinite-context'
            }
        })

        const outputTokens = summary.usageMetadata?.output_tokens ?? 0
        const reducedTokens = inputTokens - outputTokens
        const reducedPercent =
            inputTokens > 0 ? (reducedTokens / inputTokens) * 100 : 0

        logger.info(
            '[InfiniteContext] Compressed history from %d to %d (-%d, %s%%)',
            inputTokens,
            outputTokens,
            reducedTokens,
            reducedPercent.toFixed(2)
        )

        if (threshold != null && outputTokens + presetTokens > threshold) {
            logger.warn(
                '[InfiniteContext] Tokens remain above threshold after compression: %d > %d',
                outputTokens + presetTokens,
                threshold
            )
        }

        return {
            inputTokens,
            outputTokens,
            reducedTokens,
            reducedPercent,
            compressed: true,
            originalMessageCount: messages.length,
            remainingMessageCount: 1,
            messages: [message]
        }
    }

    private async _countMessagesTokens(
        model: ChatLunaChatModel,
        messages: BaseMessage[]
    ): Promise<number> {
        let total = 0

        for (const message of messages) {
            total += await model.countMessageTokens(message)
        }

        return total
    }

    private _ensureInfiniteContextChain(
        wrapper: ChatLunaLLMChainWrapper
    ): ChatLunaInfiniteContextChain {
        if (!this._chain || this._chain.model !== wrapper.model) {
            this._chain = ChatLunaInfiniteContextChain.fromLLM(wrapper.model, {
                historyMemory: wrapper.historyMemory
            })
        }

        return this._chain
    }
}
