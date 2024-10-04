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
    formatMessages,
    formatPresetTemplate,
    PresetTemplate,
    RoleBook
} from 'koishi-plugin-chatluna/llm-core/prompt'
import { logger } from '../..'
import { SystemPrompts } from './base'

export interface ChatHubChatPromptInput {
    messagesPlaceholder?: MessagesPlaceholder
    tokenCounter: (text: string) => Promise<number>
    historyMode: 'summary' | 'window'
    sendTokenLimit?: number
    preset?: () => Promise<PresetTemplate>
}

export class ChatHubChatPrompt
    extends BaseChatPromptTemplate
    implements ChatHubChatPromptInput
{
    getPreset?: () => Promise<PresetTemplate>

    tokenCounter: (text: string) => Promise<number>

    conversationSummaryPrompt?: HumanMessagePromptTemplate

    historyMode: 'summary' | 'window'

    _tempPreset?: [PresetTemplate, [SystemPrompts, string[]]]

    sendTokenLimit?: number

    constructor(fields: ChatHubChatPromptInput) {
        super({ inputVariables: ['chat_history', 'variables', 'input'] })

        this.tokenCounter = fields.tokenCounter

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
                            // ... existing code ...
                            `Relevant context: {long_history}

Guidelines for response:
1. Use the system prompt as your primary guide.
2. Consider the current conversation: {chat_history}
3. Incorporate the provided context if relevant, but don't force its inclusion.
4. Generate thoughtful, creative, and diverse responses.
5. Avoid repetition and expand your perspective.

Your goal is to craft an insightful, engaging response that seamlessly integrates all relevant information while maintaining coherence and originality.`
                    )
            } else {
                this.conversationSummaryPrompt =
                    HumanMessagePromptTemplate.fromTemplate(
                        preset.config.longMemoryPrompt ?? // eslint-disable-next-line max-len
                            `Relevant context: {long_history}

Guidelines for response:
1. Use the system prompt as your primary guide.
2. Incorporate the provided context if relevant, but don't force its inclusion.
3. Generate thoughtful, creative, and diverse responses.
4. Avoid repetition and expand your perspective.

Your goal is to craft an insightful, engaging response that seamlessly integrates all relevant information while maintaining coherence and originality.`
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
        const longHistory = (variables?.['long_memory'] ?? []) as Document[]
        const loreBooks = (variables?.['lore_books'] ?? []) as RoleBook[]
        usedTokens += inputTokens

        const formatResult =
            this.historyMode === 'window'
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

        if (loreBooks.length > 0) {
            usedTokens += await this._formatLoreBooks(
                loreBooks,
                usedTokens,
                result,
                variables
            )
        }

        result.push(input)

        logger?.debug(
            `Used tokens: ${usedTokens} exceed limit: ${this.sendTokenLimit}`
        )
        logger?.debug(`messages: ${JSON.stringify(result)}`)

        return result
    }

    private async _formatLoreBooks(
        loreBooks: RoleBook[],
        usedTokens: number,
        result: BaseMessage[],
        variables: ChainValues
    ) {
        const preset = this.tempPreset
        const tokenLimit =
            this.sendTokenLimit -
            usedTokens -
            (preset.loreBooks?.tokenLimit ?? 300)

        let usedToken = await this.tokenCounter(
            preset.config.loreBooksPrompt ?? '{input}'
        )

        const loreBooksPrompt = HumanMessagePromptTemplate.fromTemplate(
            preset.config.loreBooksPrompt ?? '{input}'
        )

        const canUseLoreBooks: Record<string, string[]> = {}

        const hasLongMemory =
            result[result.length - 1].content === 'Ok. I will remember.'

        for (const loreBook of loreBooks) {
            const loreBookTokens = await this.tokenCounter(loreBook.content)

            if (usedTokens + loreBookTokens > tokenLimit) {
                logger?.warn(
                    `Used tokens: ${usedTokens + loreBookTokens} exceed limit: ${tokenLimit}. Is too long lore books. Skipping.`
                )
                break
            }

            // TODO: insert position ???
            // loreBook.insert_position

            if (hasLongMemory) {
                result.push(new AIMessage('Ok. I will remember.'))
            }

            const position = loreBook.insertPosition

            const array = canUseLoreBooks[position] ?? []
            array.push(loreBook.content)
            canUseLoreBooks[position] = array

            usedToken += loreBookTokens
        }

        for (const [, array] of Object.entries(canUseLoreBooks)) {
            let message = await loreBooksPrompt.format({
                input: array.join('\n')
            })

            message = formatMessages([message], variables)[0]

            // TODO: insert position

            if (hasLongMemory) {
                // search the last AIMessage
                const index = result.findIndex(
                    (message) =>
                        message instanceof AIMessage &&
                        message.content === 'Ok. I will remember.'
                )

                if (index !== -1) {
                    // insert before -1
                    result.splice(index - 1, 0, message)
                } else {
                    result.push(message)
                }
            } else {
                result.push(message)
            }
        }

        return usedToken
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

            chatHistory = chatHistory.slice(-chatHistory.length * 0.6)
        }

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
            result.unshift(message)
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

    get tempPreset() {
        return this._tempPreset[0]
    }

    partial(
        values: PartialValues
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ): Promise<BasePromptTemplate<any, ChatPromptValueInterface, any>> {
        throw new Error('Method not implemented.')
    }
}
