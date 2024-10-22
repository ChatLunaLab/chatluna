/* eslint-disable max-len */
import { Document } from '@langchain/core/documents'
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
    callChatHubChain,
    ChatHubLLMCallArg,
    ChatHubLLMChain,
    ChatHubLLMChainWrapper
} from 'koishi-plugin-chatluna/llm-core/chain/base'
import { ChatLunaChatModel } from 'koishi-plugin-chatluna/llm-core/platform/model'
import {
    BufferMemory,
    ConversationSummaryMemory,
    VectorStoreRetrieverMemory
} from 'koishi-plugin-chatluna/llm-core/memory/langchain'
import { RecursiveCharacterTextSplitter } from '@langchain/textsplitters'
import { MemoryVectorStore } from 'koishi-plugin-chatluna/llm-core/vectorstores'
import { logger } from '..'
import { PresetTemplate } from 'koishi-plugin-chatluna/llm-core/prompt'
import { ChatHubChatPrompt } from 'koishi-plugin-chatluna/llm-core/chain/prompt'
import { ChatHubTool } from 'koishi-plugin-chatluna/llm-core/platform/types'
import { PuppeteerBrowserTool } from '../tools/puppeteerBrowserTool'
import { Session } from 'koishi'

// github.com/langchain-ai/weblangchain/blob/main/nextjs/app/api/chat/stream_log/route.ts#L81

export interface ChatLunaBrowsingChainInput {
    botName: string
    preset: () => Promise<PresetTemplate>
    embeddings: Embeddings

    historyMemory: ConversationSummaryMemory | BufferMemory
    enhancedSummary: boolean

    thoughtMessage: boolean

    summaryModel: ChatLunaChatModel
}

export class ChatLunaBrowsingChain
    extends ChatHubLLMChainWrapper
    implements ChatLunaBrowsingChainInput
{
    botName: string

    embeddings: Embeddings

    searchMemory: VectorStoreRetrieverMemory

    chain: ChatHubLLMChain

    historyMemory: ConversationSummaryMemory | BufferMemory

    preset: () => Promise<PresetTemplate>

    formatQuestionChain: ChatHubLLMChain

    textSplitter: RecursiveCharacterTextSplitter

    tools: ChatLunaTool[]

    cacheUrls: string[]

    responsePrompt: PromptTemplate

    enhancedSummary: boolean

    summaryModel: ChatLunaChatModel

    thoughtMessage: boolean

    constructor({
        botName,
        embeddings,
        historyMemory,
        preset,
        chain,
        tools,
        formatQuestionChain,
        enhancedSummary,
        thoughtMessage
    }: ChatLunaBrowsingChainInput & {
        chain: ChatHubLLMChain
        formatQuestionChain: ChatHubLLMChain
        tools: ChatLunaTool[]
    }) {
        super()
        this.botName = botName

        this.embeddings = embeddings
        this.enhancedSummary = enhancedSummary

        this.textSplitter = new RecursiveCharacterTextSplitter({
            chunkSize: 1400,
            chunkOverlap: 200
        })

        // use memory
        this.searchMemory = new VectorStoreRetrieverMemory({
            vectorStoreRetriever: new MemoryVectorStore(embeddings).asRetriever(
                10
            ),
            memoryKey: 'long_history',
            inputKey: 'input',
            outputKey: 'result',
            returnDocs: true
        })
        this.formatQuestionChain = formatQuestionChain

        this.historyMemory = historyMemory
        this.thoughtMessage = thoughtMessage

        this.cacheUrls = []

        this.responsePrompt = PromptTemplate.fromTemplate(RESPONSE_TEMPLATE)
        this.chain = chain
        this.tools = tools
    }

    static fromLLMAndTools(
        llm: ChatLunaChatModel,

        tools: ChatLunaTool[],
        {
            botName,
            embeddings,
            summaryModel,
            historyMemory,
            preset,
            thoughtMessage,
            enhancedSummary
        }: ChatLunaBrowsingChainInput
    ): ChatLunaBrowsingChain {
        const prompt = new ChatHubChatPrompt({
            preset,
            tokenCounter: (text) => llm.getNumTokens(text),
            historyMode:
                historyMemory instanceof ConversationSummaryMemory
                    ? 'summary'
                    : 'window',
            sendTokenLimit:
                llm.invocationParams().maxTokenLimit ??
                llm.getModelMaxContextSize()
        })

        const chain = new ChatHubLLMChain({ llm, prompt })
        const formatQuestionChain = new ChatHubLLMChain({
            llm,
            prompt: PromptTemplate.fromTemplate(REPHRASE_TEMPLATE)
        })

        return new ChatLunaBrowsingChain({
            botName,
            formatQuestionChain,
            embeddings,
            summaryModel,
            historyMemory,
            preset,
            thoughtMessage,
            chain,
            tools,
            enhancedSummary
        })
    }

    private async _selectTool(name: string): Promise<StructuredTool> {
        const chatLunaTool = this.tools.find((tool) => tool.name === name)

        return chatLunaTool.tool.createTool({
            embeddings: this.embeddings,
            model: this.summaryModel
        })
    }

    async fetchUrlContent(url: string, task: string) {
        const webTool = await this._selectTool('web-browser').then(
            (tool) => tool as PuppeteerBrowserTool
        )

        // open first
        await webTool.invoke(`open ${url}`)
        const text = await webTool.invoke(`summarize ${task}}`)

        logger?.debug('fetch url content:', text)

        await this.putContentToMemory(text, url)

        await webTool.closeBrowser()
    }

    async putContentToMemory(content: string, url: string) {
        if (this.cacheUrls.includes(url)) {
            return
        }

        await this.searchMemory.vectorStoreRetriever.vectorStore.addDocuments(
            await this.textSplitter.splitText(content).then((texts) =>
                texts.map(
                    (text) =>
                        new Document({
                            pageContent: text,
                            metadata: {
                                source: url
                            }
                        })
                )
            )
        )

        this.cacheUrls.push(url)
    }

    async call({
        message,
        stream,
        events,
        conversationId,
        session,
        variables
    }: ChatHubLLMCallArg): Promise<ChainValues> {
        const requests: ChainValues = {
            input: message
        }

        const chatHistory = (
            await this.historyMemory.loadMemoryVariables(requests)
        )[this.historyMemory.memoryKey] as BaseMessage[]

        requests['chat_history'] = chatHistory
        requests['id'] = conversationId
        requests['variables'] = variables ?? {}

        // recreate questions

        let needSearch = true
        const newQuestion = (
            await callChatHubChain(
                this.formatQuestionChain,
                {
                    chat_history: formatChatHistoryAsString(
                        chatHistory.slice(-6)
                    ),
                    question: message.content
                },
                {
                    'llm-used-token-count': events['llm-used-token-count']
                }
            )
        )['text'] as string

        if (newQuestion.includes('[skip]')) {
            needSearch = false
        }

        logger?.debug(
            `need search: ${needSearch}, new question: ${newQuestion}`
        )

        // search questions

        if (needSearch) {
            await this._search(newQuestion, message, chatHistory, session)
        }

        // format and call

        const { text: finalResponse } = await callChatHubChain(
            this.chain,
            {
                ...requests,
                stream
            },
            events
        )

        logger?.debug(`final response %c`, finalResponse)

        // remove to reduce context length
        /* if (responsePrompt.length > 0) {
            await this.historyMemory.chatHistory.addMessage(new SystemMessage(responsePrompt))
            await this.historyMemory.chatHistory.addAIChatMessage(
                "OK. I understand. I will respond to the user's question using the same language as their input. What's the user's question?"
            )
        } */

        const aiMessage = new AIMessage(finalResponse)

        return {
            message: aiMessage
        }
    }

    private async _search(
        newQuestion: string,
        message: HumanMessage,
        chatHistory: BaseMessage[],
        session: Session
    ) {
        const searchTool = await this._selectTool('web-search')

        const rawSearchResults = await searchTool.invoke(newQuestion)

        const searchResults =
            (JSON.parse(rawSearchResults as string) as unknown as {
                title: string
                description: string
                url: string
            }[]) ?? []

        if (this.thoughtMessage) {
            await session.send(
                `Find ${searchResults.length} search results about ${newQuestion}.`
            )
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

        logger?.debug('formatted search results', formattedSearchResults)

        const relatedContents: string[] = []

        let vectorSearchResults: Document[] = []

        if (this.enhancedSummary) {
            // TODO: concurrent limit
            const fetchPromises = searchResults
                .filter((result) => result.url?.startsWith('http'))
                .map(async (result) => {
                    if (result.description.length > 500) {
                        // 不对大内容作二次解读
                        await this.putContentToMemory(
                            result.description,
                            result.url
                        )

                        return
                    }

                    if (this.thoughtMessage) {
                        await session.send(`Reading ${result.url}...`)
                    }

                    try {
                        return await this.fetchUrlContent(
                            result.url,
                            newQuestion
                        )
                    } catch (e) {
                        logger.warn(`Error fetching ${result.url}:`, e)
                    }
                })

            await Promise.all(fetchPromises)

            vectorSearchResults =
                await this.searchMemory.vectorStoreRetriever.invoke(newQuestion)

            for (const result of vectorSearchResults) {
                relatedContents.push(
                    `content: ${result.pageContent}, source: ${result.metadata.source}`
                )
            }
        }

        let responsePrompt = ''
        if (searchResults?.length > 0) {
            responsePrompt = await this.responsePrompt.format({
                question: message.content,
                context:
                    relatedContents.join('\n\n') +
                    '\n\n' +
                    formattedSearchResults.join('\n\n')
            })

            chatHistory.push(new SystemMessage(responsePrompt))

            chatHistory.push(
                new AIMessage(
                    "OK. I understand. I will respond to the your's question using the same language as your input. What's the your's question?"
                )
            )

            logger?.debug('formatted search results', searchResults)
        }

        return responsePrompt
    }

    get model() {
        return this.chain.llm
    }
}

const RESPONSE_TEMPLATE = `GOAL: Generate a concise, informative answer based solely on the provided search results (URL and content).

INSTRUCTIONS:
- CRITICAL: Use the exact same language as the input. Do not translate or change the language under any circumstances.
- Use only information from the search results
- Adopt an unbiased, journalistic tone
- Combine results into a coherent answer
- Avoid repetition
- Use bullet points for readability
- Cite sources using superscript numbers in square brackets (e.g., [^1], [^2]) at the end of relevant sentences/paragraphs
- For multiple citations in one sentence, use [^1][^2]
- Never repeat the same citation number in a sentence
- If results refer to different entities with the same name, provide separate answers
- Match the system message style
- List sources as numbered references at the end using Markdown syntax
- If image sources are present in the context, include them using Markdown image syntax: ![alt text](image_url)

Content within 'context' html blocks is from a knowledge bank, not user conversation.

<context>
    {context}
</context>

IMPORTANT: Your response MUST be in the same language as the original input. This is crucial for maintaining context and accuracy. Do not translate or change the language under any circumstances.

REMEMBER: If no relevant context is found, provide an answer based on your knowledge, but inform the user it may not be current or fully accurate. Suggest they verify the information. Content within 'context' html blocks is from a knowledge bank, not user conversation.

FINAL REMINDER: Ensure that your entire response, including any explanations or suggestions, is in the exact same language as the original input.`

const REPHRASE_TEMPLATE = `Rephrase the follow-up question as a standalone, search-engine-friendly question based on the given conversation context.

Rules:
- CRITICAL: Use the exact same language as the input. Do not translate or change the language under any circumstances.
- Make the question self-contained and clear
- Optimize for search engine queries
- Do not add any explanations or additional content
- If the question doesn't require an internet search (e.g., personal opinions, simple calculations, or information already provided in the chat history), output [skip] instead of rephrasing
- If the user needs a detailed explanation, generate a new question that will provide comprehensive information on the topic

IMPORTANT: Your rephrased question or [skip] MUST be in the same language as the original input. This is crucial for maintaining context and accuracy.

Chat History:
{chat_history}
Follow-up Input: {question}
Standalone Question or [skip]:`

const formatChatHistoryAsString = (history: BaseMessage[]) => {
    return history
        .map((message) => `${message._getType()}: ${message.content}`)
        .join('\n')
}

interface ChatLunaTool {
    name: string
    tool: ChatHubTool
}
