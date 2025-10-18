/* eslint-disable max-len */
import {
    AIMessage,
    BaseMessage,
    HumanMessage,
    ToolMessage
} from '@langchain/core/messages'
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

        const compressionResult = await this._compressMessages(
            wrapper,
            stats,
            maxTokenLimit
        )

        if (!compressionResult) {
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

            compressible = contentStats.filter((stat, index) => {
                if (this._isCompressedMessage(stat.message)) {
                    return false
                }

                return index < thresholdIndex
            })

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
        const compressedSegments: {
            content: string
            chunkIndex: number
            chunkSize: number
        }[] = []

        for (let index = 0; index < chunkStats.length; index++) {
            const chunk = chunkStats[index]
            const chunkMessages = chunk.map((item) => item.message)
            const chunkText = this._formatChunkForCompression(chunkMessages)

            const compressedText = await compressor.compressChunk({
                chunk: chunkText,
                conversationId: this.options.conversationId
            })

            if (!compressedText) {
                continue
            }

            compressedSegments.push({
                content: compressedText,
                chunkIndex: index,
                chunkSize: chunkMessages.length
            })
        }

        if (compressedSegments.length === 0) {
            return null
        }

        const aggregatedSummary = compressedSegments
            .map(
                (segment, idx) =>
                    `### Segment ${idx + 1}\n${segment.content.trim()}`
            )
            .join('\n\n')

        const summaryMeta = {
            source: 'infinite-context',
            segments: compressedSegments.length,
            segmentDetail: compressedSegments.map((segment, idx) => ({
                segment: idx + 1,
                chunkIndex: segment.chunkIndex,
                chunkSize: segment.chunkSize
            }))
        }

        const compressedMessages: BaseMessage[] = [
            new HumanMessage({
                content: `<infinite_context segments="${compressedSegments.length}">\n${aggregatedSummary}\n</infinite_context>`,
                name: 'infinite_context',
                additional_kwargs: summaryMeta
            }),
            new AIMessage({
                content:
                    'Summary acknowledged. I will prioritise available tools when future turns involve these archived topics, and if no tools are available I will note the memory gap and ask the user to confirm the details.',
                name: 'infinite_context_ack',
                additional_kwargs: summaryMeta
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
                const extras: string[] = []

                const aiMessage = message as AIMessage

                if (
                    Array.isArray(aiMessage.tool_calls) &&
                    aiMessage.tool_calls.length > 0
                ) {
                    const toolCalls = aiMessage.tool_calls
                        .map((call) => {
                            let args = ''
                            try {
                                args = JSON.stringify(call.args)
                            } catch (error) {
                                args = '[unserializable]'
                            }
                            return `${call.name} => ${args}`
                        })
                        .join('; ')
                    extras.push(`tool calls: ${toolCalls}`)
                }

                if (message.getType() === 'tool') {
                    const toolMessage = message as ToolMessage
                    if (toolMessage.tool_call_id) {
                        extras.push(`tool call id: ${toolMessage.tool_call_id}`)
                    }
                    if (toolMessage.name) {
                        extras.push(`tool name: ${toolMessage.name}`)
                    }
                }

                const extraText =
                    extras.length > 0 ? `\nMeta: ${extras.join(', ')}` : ''

                return `[${role}${nameSuffix}]\n${content || '(empty)'}${extraText}`
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
}
