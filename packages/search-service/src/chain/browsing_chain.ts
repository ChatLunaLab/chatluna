/* eslint-disable max-len */
import { Embeddings } from '@langchain/core/embeddings'
import {
    AIMessage,
    BaseMessage,
    HumanMessage,
    SystemMessage
} from '@langchain/core/messages'
import { PromptTemplate } from '@langchain/core/prompts'
import { StructuredTool } from '@langchain/core/tools'
import { ChainValues } from '@langchain/core/utils/types'
import {
    callChatLunaChain,
    ChatLunaLLMCallArg,
    ChatLunaLLMChain,
    ChatLunaLLMChainWrapper
} from 'koishi-plugin-chatluna/llm-core/chain/base'
import { ChatLunaChatModel } from 'koishi-plugin-chatluna/llm-core/platform/model'
import { BufferMemory } from 'koishi-plugin-chatluna/llm-core/memory/langchain'
import { logger } from '..'
import { PresetTemplate } from 'koishi-plugin-chatluna/llm-core/prompt'
import { ChatLunaChatPrompt } from 'koishi-plugin-chatluna/llm-core/chain/prompt'
import { ChatLunaTool } from 'koishi-plugin-chatluna/llm-core/platform/types'
import { Session } from 'koishi'
import { SearchAction, SummaryType } from '../types'
import { attemptToFixJSON, preprocessContent } from '../utils/parse'
import { PuppeteerBrowserTool } from '../tools/puppeteerBrowserTool'
import {
    ChatLunaError,
    ChatLunaErrorCode
} from 'koishi-plugin-chatluna/utils/error'
import { getMessageContent } from 'koishi-plugin-chatluna/utils/string'
import { PresetFormatService } from 'koishi-plugin-chatluna/services/chat'

// github.com/langchain-ai/weblangchain/blob/main/nextjs/app/api/chat/stream_log/route.ts#L81

export interface ChatLunaBrowsingChainInput {
    botName: string
    preset: () => Promise<PresetTemplate>
    embeddings: Embeddings

    historyMemory: BufferMemory
    summaryType: SummaryType

    thoughtMessage: boolean

    summaryModel: ChatLunaChatModel

    searchPrompt: string
    newQuestionPrompt: string
    contextualCompressionPrompt?: string
    searchFailedPrompt: string
    variableService: PresetFormatService
}

export class ChatLunaBrowsingChain
    extends ChatLunaLLMChainWrapper
    implements ChatLunaBrowsingChainInput
{
    botName: string

    embeddings: Embeddings

    chain: ChatLunaLLMChain

    historyMemory: BufferMemory

    preset: () => Promise<PresetTemplate>

    formatQuestionChain: ChatLunaLLMChain

    contextualCompressionChain?: ChatLunaLLMChain

    tools: ChatLunaToolWrapper[]

    newQuestionPrompt: string

    responsePrompt: PromptTemplate

    summaryType: SummaryType

    summaryModel: ChatLunaChatModel

    contextualCompressionPrompt: string

    variableService: PresetFormatService

    thoughtMessage: boolean

    searchPrompt: string

    searchFailedPrompt: string

    constructor({
        botName,
        embeddings,
        historyMemory,
        chain,
        searchFailedPrompt,
        tools,
        formatQuestionChain,
        summaryType,
        thoughtMessage,
        searchPrompt,
        summaryModel,
        contextualCompressionChain
    }: ChatLunaBrowsingChainInput & {
        chain: ChatLunaLLMChain
        formatQuestionChain: ChatLunaLLMChain
        tools: ChatLunaToolWrapper[]
        searchPrompt: string
        contextualCompressionChain?: ChatLunaLLMChain
    }) {
        super()
        this.botName = botName

        this.embeddings = embeddings
        this.summaryType = summaryType

        // use memory

        this.formatQuestionChain = formatQuestionChain

        this.historyMemory = historyMemory
        this.thoughtMessage = thoughtMessage
        this.searchFailedPrompt = searchFailedPrompt

        this.responsePrompt = PromptTemplate.fromTemplate(searchPrompt)
        this.chain = chain
        this.tools = tools

        this.contextualCompressionChain = contextualCompressionChain
        this.summaryModel = summaryModel
    }

    static fromLLMAndTools(
        llm: ChatLunaChatModel,
        tools: ChatLunaToolWrapper[],
        {
            botName,
            embeddings,
            summaryModel,
            historyMemory,
            preset,
            thoughtMessage,
            searchPrompt,
            newQuestionPrompt,
            summaryType,
            searchFailedPrompt,
            variableService,
            contextualCompressionPrompt
        }: ChatLunaBrowsingChainInput
    ): ChatLunaBrowsingChain {
        const prompt = new ChatLunaChatPrompt({
            preset,
            tokenCounter: (text) => llm.getNumTokens(text),
            sendTokenLimit:
                llm.invocationParams().maxTokenLimit ??
                llm.getModelMaxContextSize(),
            variableService
        })

        const chain = new ChatLunaLLMChain({ llm, prompt })
        const formatQuestionChain = new ChatLunaLLMChain({
            llm: summaryModel,
            prompt: PromptTemplate.fromTemplate(newQuestionPrompt)
        })

        const contextualCompressionChain = contextualCompressionPrompt
            ? new ChatLunaLLMChain({
                  llm: summaryModel,
                  prompt: PromptTemplate.fromTemplate(
                      contextualCompressionPrompt
                  )
              })
            : undefined

        return new ChatLunaBrowsingChain({
            variableService,
            botName,
            formatQuestionChain,
            embeddings,
            summaryModel,
            historyMemory,
            preset,
            thoughtMessage,
            searchFailedPrompt,
            searchPrompt,
            newQuestionPrompt,
            chain,
            tools,
            summaryType,
            contextualCompressionChain
        })
    }

    private async _selectTool(name: string): Promise<StructuredTool> {
        const chatLunaTool = this.tools.find((tool) => tool.name === name)

        return chatLunaTool.tool.createTool({
            embeddings: this.embeddings,
            model: this.summaryModel ?? this.chain.llm
        })
    }

    async call({
        message,
        stream,
        events,
        conversationId,
        session,
        variables,
        maxToken,
        signal
    }: ChatLunaLLMCallArg): Promise<ChainValues> {
        const requests: ChainValues = {
            input: message
        }

        let chatHistory = (
            await this.historyMemory.loadMemoryVariables(requests)
        )[this.historyMemory.memoryKey] as BaseMessage[]

        chatHistory = chatHistory.slice()

        requests['chat_history'] = chatHistory
        requests['id'] = conversationId
        requests['variables'] = variables ?? {}

        // recreate questions

        const newQuestion = (
            await callChatLunaChain(
                this.formatQuestionChain,
                {
                    chat_history: formatChatHistoryAsString(
                        chatHistory.slice(-6)
                    ),
                    time: new Date().toLocaleString(),
                    question: message.content,
                    temperature: 0,
                    signal
                },
                {
                    'llm-used-token-count': events['llm-used-token-count']
                }
            )
        )['text'] as string

        const searchAction = this.parseSearchAction(newQuestion)

        logger?.debug(`action: ${JSON.stringify(searchAction)}`)

        // search questions

        if (searchAction != null && searchAction.action !== 'skip') {
            await this._search(
                searchAction,
                message,
                chatHistory,
                session,
                events,
                signal
            )
        }

        // format and call

        const finalResponse = await callChatLunaChain(
            this.chain,
            {
                ...requests,
                stream,
                signal,
                maxTokens: maxToken
            },
            events
        )

        logger?.debug(`final response %c`, finalResponse.text)

        // remove to reduce context length
        /* if (responsePrompt.length > 0) {
            await this.historyMemory.chatHistory.addMessage(new SystemMessage(responsePrompt))
            await this.historyMemory.chatHistory.addAIChatMessage(
                "OK. I understand. I will respond to the user's question using the same language as their input. What's the user's question?"
            )
        } */

        const aiMessage =
            (finalResponse?.message as AIMessage) ??
            new AIMessage(finalResponse.text)

        return {
            message: aiMessage
        }
    }

    private parseSearchAction(action: string): SearchAction {
        action = preprocessContent(action)

        try {
            return JSON.parse(action) as SearchAction
        } catch (e) {
            action = attemptToFixJSON(action)

            try {
                return JSON.parse(action) as SearchAction
            } catch (e) {
                logger?.error(`parse search action failed: ${e}`)
            }
        }

        if (action.includes('[skip]')) {
            return {
                action: 'skip',
                thought: 'skip the search'
            }
        }

        return {
            action: 'search',
            thought: action,
            content: [action]
        }
    }

    private async _search(
        action: SearchAction,
        message: HumanMessage,
        chatHistory: BaseMessage[],
        session: Session,
        events: ChatLunaLLMCallArg['events'],
        signal: AbortSignal
    ) {
        const searchTool = await this._selectTool('web-search')

        const webBrowserTool = (await this._selectTool(
            'web-browser'
        )) as PuppeteerBrowserTool

        const searchResults: {
            title: string
            description: string
            url: string
        }[] = []

        if (!Array.isArray(action.content)) {
            logger?.error(
                `search action content is not an array: ${JSON.stringify(action)}`
            )
            return
        }

        if (this.thoughtMessage) {
            await session.send(
                `Search Action: ${action.action}\nThought: ${action.thought}\nContent: ${action.content.join('\n')}`
            )
        }

        const searchByQuestion = async (
            question: string,
            signal: AbortSignal
        ) => {
            // Use the rephrased question for search
            const rawSearchResults = await Promise.race([
                searchTool.invoke(question).then((text) => text as string),
                new Promise<never>((resolve, reject) => {
                    signal?.addEventListener('abort', (event) => {
                        reject(new ChatLunaError(ChatLunaErrorCode.ABORTED))
                    })
                })
            ])

            const parsedSearchResults =
                (JSON.parse(rawSearchResults) as unknown as {
                    title: string
                    description: string
                    url: string
                }[]) ?? []

            if (this.thoughtMessage) {
                await session.send(
                    `Find ${parsedSearchResults.length} search results about ${question}.`
                )
            }

            searchResults.push(...parsedSearchResults)
        }

        const searchByUrl = async (url: string, signal: AbortSignal) => {
            const text = await Promise.race([
                webBrowserTool
                    .invoke({
                        action: 'text',
                        url
                    })
                    .then((text) => text as string),
                new Promise<never>((resolve, reject) => {
                    signal?.addEventListener('abort', (event) => {
                        reject(new ChatLunaError(ChatLunaErrorCode.ABORTED))
                    })
                })
            ])

            if (this.thoughtMessage) {
                await session.send(`Open ${url} and read the content.`)
            }

            searchResults.push({
                title: url,
                description: text,
                url
            })
        }

        if (action.action === 'url') {
            await Promise.race([
                Promise.all(
                    action.content.map((url) => searchByUrl(url, signal))
                ),
                new Promise((resolve, reject) => {
                    signal?.addEventListener('abort', (event) => {
                        reject(new ChatLunaError(ChatLunaErrorCode.ABORTED))
                    })
                })
            ])
        } else if (action.action === 'search') {
            await Promise.race([
                Promise.all(
                    action.content.map((question) =>
                        searchByQuestion(question, signal)
                    )
                ),
                new Promise((resolve, reject) => {
                    signal?.addEventListener('abort', (event) => {
                        reject(new ChatLunaError(ChatLunaErrorCode.ABORTED))
                    })
                })
            ])
        }

        // format questions

        const formattedSearchResults = searchResults.map((result) => {
            // sort like json style
            // title: xx, xx: xx like
            let resultString = ''

            for (const key in result) {
                resultString += `${key}: ${result[key]}, `
            }

            resultString = resultString.slice(0, -2)

            return resultString
        })

        let responsePrompt = ''
        if (formattedSearchResults?.length > 0) {
            let formattedSearchResult = formattedSearchResults.join('\n\n')

            if (this.contextualCompressionChain) {
                try {
                    formattedSearchResult = (
                        await callChatLunaChain(
                            this.contextualCompressionChain,
                            {
                                action: JSON.stringify(action),
                                context: formattedSearchResult,
                                temperature: 0,
                                signal
                            },
                            {
                                'llm-used-token-count':
                                    events['llm-used-token-count']
                            }
                        )
                    )['text'] as string

                    console.log(formattedSearchResult)
                } catch (e) {
                    logger?.error(`contextual compression failed: ${e}`)
                }
            }

            responsePrompt = await this.responsePrompt.format({
                question: message.content,
                context: formattedSearchResult
            })

            chatHistory.push(new SystemMessage(responsePrompt))

            chatHistory.push(
                new AIMessage(
                    "OK. I understand. I will respond to the your's question using the same language as your input. What's the your's question?"
                )
            )
        } else if (this.searchFailedPrompt?.length > 0) {
            chatHistory.push(
                new SystemMessage(
                    this.searchFailedPrompt.replaceAll(
                        '{question}',
                        getMessageContent(message.content)
                    )
                )
            )
        }

        await webBrowserTool.closeBrowser()

        return responsePrompt
    }

    get model() {
        return this.chain.llm
    }
}

const formatChatHistoryAsString = (history: BaseMessage[]) => {
    return history
        .map((message) => `${message.getType()}: ${message.content}`)
        .join('\n')
}

interface ChatLunaToolWrapper {
    name: string
    tool: ChatLunaTool
}

export function chunkArray<T>(array: T[], size: number): T[][] {
    return Array.from({ length: Math.ceil(array.length / size) }, (_, i) =>
        array.slice(i * size, i * size + size)
    )
}
