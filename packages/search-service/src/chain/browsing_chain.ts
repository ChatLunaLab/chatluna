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

// github.com/langchain-ai/weblangchain/blob/main/nextjs/app/api/chat/stream_log/route.ts#L81

export interface ChatLunaBrowsingChainInput {
    botName: string
    preset: () => Promise<PresetTemplate>
    embeddings: Embeddings

    historyMemory: ConversationSummaryMemory | BufferMemory
    enhancedSummary: boolean

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

    responsePrompt: PromptTemplate

    enhancedSummary: boolean

    summaryModel: ChatLunaChatModel

    constructor({
        botName,
        embeddings,
        historyMemory,
        preset,
        chain,
        tools,
        formatQuestionChain,
        enhancedSummary
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
                6
            ),
            memoryKey: 'long_history',
            inputKey: 'input',
            outputKey: 'result',
            returnDocs: true
        })
        this.formatQuestionChain = formatQuestionChain

        this.historyMemory = historyMemory

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
        const webTool = await this._selectTool('web_browser').then(
            (tool) => tool as PuppeteerBrowserTool
        )

        const text = await webTool.invoke(`summarize ${task}}`)

        logger?.debug('fetch url content:', text)

        await this.searchMemory.vectorStoreRetriever.vectorStore.addDocuments(
            await this.textSplitter.splitText(text).then((texts) =>
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

        await webTool.closeBrowser()
    }

    async call({
        message,
        stream,
        events,
        conversationId,
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
                    chat_history: formatChatHistoryAsString(chatHistory),
                    question: message.content
                },
                {
                    'llm-used-token-count': events['llm-used-token-count']
                }
            )
        )['text'] as string

        if (newQuestion === '[skip]') {
            needSearch = false
        }

        logger?.debug(
            `need search: ${needSearch}, new question: ${newQuestion}`
        )

        // search questions

        let responsePrompt = ''

        if (needSearch) {
            responsePrompt = await this._search(
                newQuestion,
                message,
                chatHistory
            )
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
        if (responsePrompt.length > 0) {
            await this.historyMemory.chatHistory.addUserMessage(responsePrompt)
            await this.historyMemory.chatHistory.addAIChatMessage(
                "OK. What's your question?"
            )
        }

        const aiMessage = new AIMessage(finalResponse)

        return {
            message: aiMessage
        }
    }

    private async _search(
        newQuestion: string,
        message: HumanMessage,
        chatHistory: BaseMessage[]
    ) {
        const searchTool = await this._selectTool('web_search')

        const rawSearchResults = await searchTool.invoke(newQuestion)

        const searchResults =
            (JSON.parse(rawSearchResults as string) as unknown as {
                title: string
                description: string
                url: string
            }[]) ?? []

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

        logger?.debug(`search results %c`, formattedSearchResults)

        const relatedContents: string[] = []

        let vectorSearchResults: Document[] = []

        if (this.enhancedSummary) {
            for (const result of searchResults) {
                if (!result.url?.startsWith('http')) {
                    continue
                }

                try {
                    logger.debug(`fetching ${result.url}`)
                    await this.fetchUrlContent(result.url, newQuestion)
                } catch (e) {
                    logger.warn(e)
                }
            }

            vectorSearchResults =
                await this.searchMemory.vectorStoreRetriever.invoke(newQuestion)

            for (const result of vectorSearchResults) {
                relatedContents.push(result.pageContent)
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

            chatHistory.push(new AIMessage("OK. What's your question?"))

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

Match the input language in your response.

<context>
    {context}
<context/>

REMEMBER: If no relevant context is found, provide an answer based on your knowledge, but inform the user it may not be current or fully accurate. Suggest they verify the information. Content within 'context' html blocks is from a knowledge bank, not user conversation. Match the input language in your response.`
const REPHRASE_TEMPLATE = `Rephrase the follow-up question as a standalone, search-engine-friendly question based on the given conversation context.

Rules:
- Use the same language as the input
- Make the question self-contained and clear
- Optimize for search engine queries
- Do not add any explanations or additional content
- If the question doesn't require an internet search (e.g., personal opinions, simple calculations, or information already provided in the chat history), output [skip] instead of rephrasing

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
