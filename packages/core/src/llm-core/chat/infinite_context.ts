/* eslint-disable max-len */
import { BaseMessage, HumanMessage } from '@langchain/core/messages'
import { ChatLunaChatModel } from 'koishi-plugin-chatluna/llm-core/platform/model'
import { ChatLunaLLMChainWrapper } from 'koishi-plugin-chatluna/llm-core/chain/base'
import { getMessageContent } from 'koishi-plugin-chatluna/utils/string'
import { logger } from 'koishi-plugin-chatluna'
import { ComputedRef } from '@vue/reactivity'
import { KoishiChatMessageHistory } from 'koishi-plugin-chatluna/llm-core/memory/message'
import { ChatLunaInfiniteContextChain } from '../chain/infinite_context_chain'
import { PresetTemplate } from 'koishi-plugin-chatluna/llm-core/prompt'

type MessageTokenStat = {
    message: BaseMessage
    tokens: number
}

export interface InfiniteContextManagerOptions {
    chatHistory: KoishiChatMessageHistory
    conversationId: string
    preset?: ComputedRef<PresetTemplate>
}

export class InfiniteContextManager {
    private _chain?: ChatLunaInfiniteContextChain

    constructor(private readonly options: InfiniteContextManagerOptions) {}

    async compressIfNeeded(wrapper: ChatLunaLLMChainWrapper): Promise<void> {
        const model = wrapper.model

        if (!model) {
            return
        }

        const messages = await this.options.chatHistory.getMessages()

        if (messages.length === 0) {
            return
        }

        const invocation = model.invocationParams()
        const maxTokenLimit =
            invocation.maxTokenLimit && invocation.maxTokenLimit > 0
                ? invocation.maxTokenLimit
                : model.getModelMaxContextSize()

        if (!maxTokenLimit || maxTokenLimit <= 0) {
            return
        }

        const presetMessages = Array.isArray(
            this.options.preset?.value?.messages
        )
            ? (this.options.preset?.value.messages as BaseMessage[])
            : []

        const presetTokens = await this._calculateMessageTokenStats(
            model,
            presetMessages
        ).then((stats) =>
            stats.reduce((sum, current) => sum + current.tokens, 0)
        )

        const threshold = Math.floor(maxTokenLimit * 0.85)

        const stats = await this._calculateMessageTokenStats(model, messages)
        const totalTokens =
            stats.reduce((sum, current) => sum + current.tokens, 0) +
            presetTokens

        if (totalTokens <= threshold) {
            return
        }

        logger.info(
            `[InfiniteContext] Start compression with total tokens: ${totalTokens}, threshold: ${threshold}`
        )

        const filteredMessages = messages.filter(
            (message) => !this._isToolRelatedMessage(message)
        )

        if (filteredMessages.length === 0) {
            return
        }

        const filteredStats = await this._calculateMessageTokenStats(
            model,
            filteredMessages
        )

        const filteredTotalTokens =
            filteredStats.reduce((sum, current) => sum + current.tokens, 0) +
            presetTokens

        if (filteredTotalTokens <= threshold) {
            await this._rewriteChatHistory(filteredMessages)

            logger.info(
                '[InfiniteContext] Filtered tool-related messages reduced tokens from %d to %d',
                totalTokens,
                filteredTotalTokens
            )

            return
        }

        const compressionResult = await this._compressMessages(
            wrapper,
            filteredStats,
            maxTokenLimit
        )

        if (!compressionResult) {
            if (filteredMessages.length !== messages.length) {
                await this._rewriteChatHistory(filteredMessages)
                logger.info(
                    '[InfiniteContext] Filtered tool-related messages (compression skipped) reduced tokens from %d to %d',
                    totalTokens,
                    filteredTotalTokens
                )
            }
            return
        }

        const { messages: rewrittenMessages, tokenCount } = compressionResult

        const additionalArgs = {
            ...(await this.options.chatHistory.getAdditionalArgs())
        }

        await this.options.chatHistory.clear()

        for (const message of rewrittenMessages) {
            await this.options.chatHistory.addMessage(message)
        }

        if (Object.keys(additionalArgs).length > 0) {
            await this.options.chatHistory.overrideAdditionalArgs(
                additionalArgs
            )
        }

        await this.options.chatHistory.loadConversation()

        // Add presetTokens to post-compression count for consistent comparison
        const newTotalTokens = tokenCount + presetTokens
        const reducedTokens = totalTokens - newTotalTokens
        const reducedPercent =
            totalTokens > 0 ? (reducedTokens / totalTokens) * 100 : 0

        logger.info(
            '[InfiniteContext] Compressed tokens from %d to %d (-%d, -%s%%)',
            totalTokens,
            newTotalTokens,
            reducedTokens,
            reducedPercent.toFixed(2)
        )

        if (newTotalTokens > threshold) {
            logger.warn(
                '[InfiniteContext] Tokens remain above threshold after compression: %d > %d',
                newTotalTokens,
                threshold
            )
        }
    }

    private async _compressMessages(
        wrapper: ChatLunaLLMChainWrapper,
        stats: MessageTokenStat[],
        maxTokenLimit: number
    ): Promise<{ messages: BaseMessage[]; tokenCount: number } | null> {
        const model = wrapper.model

        const systemStats = stats.filter(
            (item) => item.message.getType() === 'system'
        )
        const contentStats = stats.filter(
            (item) => item.message.getType() !== 'system'
        )

        if (contentStats.length === 0) {
            return null
        }

        let preserveCount = Math.min(8, contentStats.length)
        let compressible: MessageTokenStat[] = []

        while (preserveCount >= 0) {
            const thresholdIndex = Math.max(
                0,
                contentStats.length - preserveCount
            )

            compressible = contentStats.filter(
                (stat, index) => index < thresholdIndex
            )

            if (compressible.length > 0) {
                break
            }

            preserveCount -= 1
        }

        if (compressible.length === 0) {
            return null
        }

        const compressibleSet = new Set(compressible)
        const preserved = contentStats.filter(
            (stat) => !compressibleSet.has(stat)
        )

        const chunkStats = this._splitChunksForCompression(
            compressible,
            maxTokenLimit
        )

        if (chunkStats.length === 0) {
            return null
        }

        const compressor = this._ensureInfiniteContextChain(wrapper)
        const chunkSummaries: {
            content: string
            chunkIndex: number
            chunkSize: number
        }[] = []

        const previousSummaries = compressible
            .filter((stat) => this._isCompressedMessage(stat.message))
            .map(
                (stat) => getMessageContent(stat.message.content)?.trim() ?? ''
            )
            .filter((text) => text.length > 0)

        for (let index = 0; index < chunkStats.length; index++) {
            const chunk = chunkStats[index]
            const chunkMessages = chunk
                .map((item) => item.message)
                // Once a summary is produced, treat it as standalone context and do not mix it into chunk compression again.
                .filter((message) => !this._isCompressedMessage(message))

            if (chunkMessages.length === 0) {
                continue
            }

            const chunkText = this._formatChunkForCompression(chunkMessages)

            const compressedText = await compressor.compressChunk({
                chunk: chunkText,
                conversationId: this.options.conversationId
            })

            if (!compressedText) {
                continue
            }

            chunkSummaries.push({
                content: compressedText,
                chunkIndex: index,
                chunkSize: chunkMessages.length
            })
        }

        if (chunkSummaries.length === 0 && previousSummaries.length === 0) {
            return null
        }

        const finalSummary = await this._buildFinalSummary(
            compressor,
            previousSummaries,
            chunkSummaries
        )

        if (!finalSummary) {
            return null
        }

        const compressedMessages: BaseMessage[] = [
            new HumanMessage({
                content: finalSummary.content,
                name: 'infinite_context',
                additional_kwargs: finalSummary.meta
            })
        ]

        const mergedMessages = [
            ...systemStats.map((item) => item.message),
            ...compressedMessages,
            ...preserved.map((item) => item.message)
        ]

        const tokenCount = await this._countMessagesTokens(
            model,
            mergedMessages
        )

        return {
            messages: mergedMessages,
            tokenCount
        }
    }

    private _isCompressedMessage(message: BaseMessage): boolean {
        const source = message?.additional_kwargs?.['source']
        if (source === 'infinite-context') {
            return true
        }

        if (message?.name === 'infinite_context') {
            return true
        }

        const content = getMessageContent(message?.content ?? '')
        return (
            typeof content === 'string' &&
            /<\/?infinite_context/iu.test(content)
        )
    }

    private _isToolRelatedMessage(message: BaseMessage): boolean {
        if (message.getType() === 'tool') {
            return true
        }

        const anyMessage = message as unknown as {
            tool_calls?: unknown
            additional_kwargs?: Record<string, unknown>
        }

        if (
            Array.isArray(anyMessage.tool_calls) &&
            anyMessage.tool_calls.length > 0
        ) {
            return true
        }

        const additionalToolCalls = anyMessage.additional_kwargs?.[
            'tool_calls'
        ] as unknown

        return (
            Array.isArray(additionalToolCalls) && additionalToolCalls.length > 0
        )
    }

    private async _rewriteChatHistory(messages: BaseMessage[]): Promise<void> {
        const additionalArgs = {
            ...(await this.options.chatHistory.getAdditionalArgs())
        }

        await this.options.chatHistory.clear()

        for (const message of messages) {
            await this.options.chatHistory.addMessage(message)
        }

        if (Object.keys(additionalArgs).length > 0) {
            await this.options.chatHistory.overrideAdditionalArgs(additionalArgs)
        }

        await this.options.chatHistory.loadConversation()
    }

    private _splitChunksForCompression(
        stats: MessageTokenStat[],
        maxTokenLimit: number
    ): MessageTokenStat[][] {
        const chunkTokenTarget = Math.max(Math.floor(maxTokenLimit * 0.15), 300)
        const chunks: MessageTokenStat[][] = []
        let currentChunk: MessageTokenStat[] = []
        let currentTokens = 0

        for (const stat of stats) {
            if (
                currentChunk.length > 0 &&
                currentTokens + stat.tokens > chunkTokenTarget
            ) {
                chunks.push(currentChunk)
                currentChunk = []
                currentTokens = 0
            }

            currentChunk.push(stat)
            currentTokens += stat.tokens
        }

        if (currentChunk.length > 0) {
            chunks.push(currentChunk)
        }

        return chunks
    }

    private async _calculateMessageTokenStats(
        model: ChatLunaChatModel,
        messages: BaseMessage[]
    ): Promise<MessageTokenStat[]> {
        const stats: MessageTokenStat[] = []

        for (const message of messages) {
            const tokens = await model.countMessageTokens(message)
            stats.push({ message, tokens })
        }

        return stats
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

    private _formatChunkForCompression(messages: BaseMessage[]): string {
        return messages
            .map((message) => {
                const role = message.getType().toUpperCase()
                const nameSuffix = message.name ? ` (${message.name})` : ''
                const content = getMessageContent(message.content).trim()
                return `[${role}${nameSuffix}]\n${content || '(empty)'}`
            })
            .join('\n---\n')
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

    private async _buildFinalSummary(
        compressor: ChatLunaInfiniteContextChain,
        previousSummaries: string[],
        chunkSummaries: {
            content: string
            chunkIndex: number
            chunkSize: number
        }[]
    ): Promise<{
        content: string
        meta: Record<string, unknown>
    } | null> {
        const cleanedPrevious = previousSummaries.filter(
            (text) => text.trim().length > 0
        )
        const cleanedChunks = chunkSummaries.filter(
            (summary) => summary.content.trim().length > 0
        )

        if (cleanedPrevious.length === 0 && cleanedChunks.length === 0) {
            return null
        }

        if (cleanedPrevious.length === 0 && cleanedChunks.length === 1) {
            return {
                content: cleanedChunks[0].content.trim(),
                meta: {
                    source: 'infinite-context',
                    mergedSegments: 1,
                    previousSummaries: 0,
                    chunkDetail: [
                        {
                            chunkIndex: cleanedChunks[0].chunkIndex,
                            chunkSize: cleanedChunks[0].chunkSize
                        }
                    ]
                }
            }
        }

        // Build a virtual transcript that first feeds the existing summary and then the new chunk summaries.
        const virtualTranscript: string[] = []

        if (cleanedPrevious.length > 0) {
            virtualTranscript.push(
                `Existing summary snapshot:\n${cleanedPrevious.join('\n\n')}`
            )
        }

        cleanedChunks.forEach((chunk, index) => {
            virtualTranscript.push(
                `Recent segment ${index + 1} (${chunk.chunkSize} turns):\n${chunk.content}`
            )
        })

        const mergedInput = virtualTranscript.join('\n\n---\n\n')

        const refined = await compressor.compressChunk({
            chunk: mergedInput,
            conversationId: this.options.conversationId
        })

        const content = refined?.trim() || mergedInput

        return {
            content,
            meta: {
                source: 'infinite-context',
                mergedSegments: cleanedChunks.length,
                previousSummaries: cleanedPrevious.length,
                chunkDetail: cleanedChunks.map((chunk) => ({
                    chunkIndex: chunk.chunkIndex,
                    chunkSize: chunk.chunkSize
                }))
            }
        }
    }
}
