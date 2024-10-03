/* eslint-disable max-len */
import { Document } from '@langchain/core/documents'
import { AIMessage, BaseMessage, HumanMessage } from '@langchain/core/messages'
import { ChatPromptValueInterface } from '@langchain/core/prompt_values'
import {
    BaseChatPromptTemplate,
    BasePromptTemplate,
    HumanMessagePromptTemplate,
    MessagesPlaceholder
} from '@langchain/core/prompts'
import { ChainValues, PartialValues } from '@langchain/core/utils/types'
import { messageTypeToOpenAIRole } from 'koishi-plugin-chatluna/llm-core/utils/count_tokens'
import {
    formatPresetTemplate,
    PresetTemplate
} from 'koishi-plugin-chatluna/llm-core/prompt'
import { SystemPrompts } from 'koishi-plugin-chatluna/llm-core/chain/base'

import { logger } from '../index'

export interface ChatHubBrowsingPromptInput {
    messagesPlaceholder?: MessagesPlaceholder
    tokenCounter: (text: string) => Promise<number>
    historyMode: 'summary' | 'window'
    sendTokenLimit?: number
    preset?: () => Promise<PresetTemplate>
}

export class ChatHubBrowsingPrompt
    extends BaseChatPromptTemplate
    implements ChatHubBrowsingPromptInput
{
    getPreset?: () => Promise<PresetTemplate>

    tokenCounter: (text: string) => Promise<number>

    messagesPlaceholder?: MessagesPlaceholder

    conversationSummaryPrompt?: HumanMessagePromptTemplate

    historyMode: 'summary' | 'window'

    _tempPreset?: [PresetTemplate, [SystemPrompts, string[]]]

    sendTokenLimit?: number

    constructor(fields: ChatHubBrowsingPromptInput) {
        super({ inputVariables: ['chat_history', 'variables', 'input'] })

        this.tokenCounter = fields.tokenCounter

        this.messagesPlaceholder = fields.messagesPlaceholder

        this.sendTokenLimit = fields.sendTokenLimit ?? 4096
        this.getPreset = fields.preset
        this.historyMode = fields.historyMode
    }

    _getPromptType() {
        return 'chathub_chat' as const
    }

    private async _countMessageTokens(message: BaseMessage) {
        let result =
            (await this.tokenCounter(message.content as string)) +
            (await this.tokenCounter(
                messageTypeToOpenAIRole(message._getType())
            ))

        if (message.name) {
            result += await this.tokenCounter(message.name)
        }

        return result
    }

    private async _formatSystemPrompts(variables: ChainValues) {
        const preset = await this.getPreset()

        if (!this._tempPreset || this._tempPreset[0] !== preset) {
            if (this.historyMode === 'summary') {
                this.conversationSummaryPrompt =
                    HumanMessagePromptTemplate.fromTemplate(
                        preset.config.longMemoryPrompt ?? // eslint-disable-next-line max-len
                            `Here are some memories about the user. Please generate response based on the system prompt and content below. Relevant pieces of previous conversation: {long_history} (You do not need to use these pieces of information if not relevant, and based on these information, generate similar but non-repetitive responses. Pay attention, you need to think more and diverge your creativity) Current conversation: {chat_history}`
                    )

                this.messagesPlaceholder = undefined
            } else {
                this.conversationSummaryPrompt =
                    HumanMessagePromptTemplate.fromTemplate(
                        preset.config.longMemoryPrompt ?? // eslint-disable-next-line max-len
                            `Here are some memories about the user: {long_history} (You do not need to use these pieces of information if not relevant, and based on these information, generate similar but non-repetitive responses. Pay attention, you need to think more and diverge your creativity.)`
                    )

                this.messagesPlaceholder = new MessagesPlaceholder(
                    'chat_history'
                )
            }
        }

        const result = formatPresetTemplate(preset, variables, true) as [
            BaseMessage[],
            string[]
        ]

        this._tempPreset = [preset, result]

        return result
    }

    async formatMessages({
        chat_history: chatHistory,
        input,
        variables
    }: {
        input: BaseMessage
        chat_history: BaseMessage[] | string
        variables?: ChainValues
    }) {
        const result: BaseMessage[] = []
        let usedTokens = 0

        const [systemPrompts] = await this._formatSystemPrompts(variables)

        for (const message of systemPrompts || []) {
            const messageTokens = await this._countMessageTokens(message)
            result.push(message)
            usedTokens += messageTokens
        }

        const inputTokens = await this.tokenCounter(input.content as string)
        const longHistory = (variables?.['long_history'] ?? []) as Document[]
        usedTokens += inputTokens

        const formatResult = this.messagesPlaceholder
            ? await this._formatWithMessagesPlaceholder(
                  chatHistory as BaseMessage[],
                  longHistory,
                  usedTokens
              )
            : await this._formatWithoutMessagesPlaceholder(
                  chatHistory as string,
                  longHistory,
                  usedTokens
              )

        result.push(...formatResult.messages)
        usedTokens = formatResult.usedTokens

        result.push(input)

        logger?.debug(
            `Used tokens: ${usedTokens} exceed limit: ${this.sendTokenLimit}`
        )
        logger?.debug(`messages: ${JSON.stringify(result)}`)

        return result
    }

    private async _formatWithoutMessagesPlaceholder(
        chatHistory: string,
        longHistory: Document[],
        usedTokens: number
    ): Promise<{ messages: BaseMessage[]; usedTokens: number }> {
        const result: BaseMessage[] = []
        const chatHistoryTokens = await this.tokenCounter(chatHistory)

        if (usedTokens + chatHistoryTokens > this.sendTokenLimit) {
            logger?.warn(
                `Used tokens: ${usedTokens + chatHistoryTokens} exceed limit: ${this.sendTokenLimit}. Is too long history. Splitting the history.`
            )
        }

        chatHistory = chatHistory.slice(-chatHistory.length * 0.6)

        if (longHistory.length > 0) {
            const { formatConversationSummary, usedTokens: newUsedTokens } =
                await this._formatLongHistory(
                    longHistory,
                    chatHistory,
                    usedTokens
                )

            if (formatConversationSummary) {
                result.push(formatConversationSummary)
                result.push(new AIMessage('Ok. I will remember.'))
            }

            usedTokens = newUsedTokens
        }

        return { messages: result, usedTokens }
    }

    private async _formatWithMessagesPlaceholder(
        chatHistory: BaseMessage[],
        longHistory: Document[],
        usedTokens: number
    ): Promise<{ messages: BaseMessage[]; usedTokens: number }> {
        const result: BaseMessage[] = []
        const formatChatHistory: BaseMessage[] = []

        for (const message of chatHistory.reverse()) {
            const messageTokens = await this._countMessageTokens(message)

            if (
                usedTokens + messageTokens >
                this.sendTokenLimit - (longHistory.length > 0 ? 480 : 80)
            ) {
                break
            }

            usedTokens += messageTokens
            formatChatHistory.unshift(message)
        }

        if (longHistory.length > 0) {
            const { formatConversationSummary, usedTokens: newUsedTokens } =
                await this._formatLongHistory(
                    longHistory,
                    formatChatHistory,
                    usedTokens
                )

            if (formatConversationSummary) {
                result.push(formatConversationSummary)
                result.push(new AIMessage('Ok. I will remember.'))
            }

            usedTokens = newUsedTokens
        }

        const formatMessagesPlaceholder =
            await this.messagesPlaceholder.formatMessages({
                chat_history: formatChatHistory
            })

        result.push(...formatMessagesPlaceholder)

        return { messages: result, usedTokens }
    }

    private async _formatLongHistory(
        longHistory: Document[],
        chatHistory: BaseMessage[] | string,
        usedTokens: number
    ): Promise<{
        formatConversationSummary: HumanMessage | null
        usedTokens: number
    }> {
        const formatDocuments: Document[] = []

        for (const document of longHistory) {
            const documentTokens = await this.tokenCounter(document.pageContent)

            if (usedTokens + documentTokens > this.sendTokenLimit - 80) {
                break
            }

            usedTokens += documentTokens
            formatDocuments.push(document)
        }

        const formatConversationSummary =
            formatDocuments.length > 0
                ? await this.conversationSummaryPrompt.format({
                      long_history: formatDocuments
                          .map((document) => document.pageContent)
                          .join('\n'),
                      chat_history: chatHistory
                  })
                : null

        return { formatConversationSummary, usedTokens }
    }

    partial(
        values: PartialValues
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ): Promise<BasePromptTemplate<any, ChatPromptValueInterface, any>> {
        throw new Error('Method not implemented.')
    }
}
