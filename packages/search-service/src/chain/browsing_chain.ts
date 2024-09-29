/* eslint-disable max-len */
import { Document } from '@langchain/core/documents'
import { Embeddings } from '@langchain/core/embeddings'
import {
    AIMessage,
    BaseMessage,
    HumanMessage,
    SystemMessage
} from '@langchain/core/messages'
import {
    HumanMessagePromptTemplate,
    MessagesPlaceholder,
    PromptTemplate
} from '@langchain/core/prompts'
import { StructuredTool, Tool } from '@langchain/core/tools'
import { ChainValues } from '@langchain/core/utils/types'
import {
    callChatHubChain,
    ChatHubLLMCallArg,
    ChatHubLLMChain,
    ChatHubLLMChainWrapper,
    SystemPrompts
} from 'koishi-plugin-chatluna/llm-core/chain/base'
import { ChatLunaSaveableVectorStore } from 'koishi-plugin-chatluna/llm-core/model/base'
import { ChatLunaChatModel } from 'koishi-plugin-chatluna/llm-core/platform/model'
import {
    BufferMemory,
    ConversationSummaryMemory,
    VectorStoreRetrieverMemory
} from 'langchain/memory'
import { RecursiveCharacterTextSplitter } from 'langchain/text_splitter'
import { MemoryVectorStore } from 'langchain/vectorstores/memory'
import { logger } from '..'
import { ChatHubBrowsingPrompt } from './prompt'

// github.com/langchain-ai/weblangchain/blob/main/nextjs/app/api/chat/stream_log/route.ts#L81

export interface ChatLunaBrowsingChainInput {
    botName: string
    systemPrompts?: SystemPrompts
    embeddings: Embeddings
    longMemory: VectorStoreRetrieverMemory
    historyMemory: ConversationSummaryMemory | BufferMemory
    enhancedSummary: boolean
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

    systemPrompts?: SystemPrompts

    longMemory: VectorStoreRetrieverMemory

    formatQuestionChain: ChatHubLLMChain

    textSplitter: RecursiveCharacterTextSplitter

    tools: StructuredTool[]

    responsePrompt: PromptTemplate

    enhancedSummary: boolean

    constructor({
        botName,
        embeddings,
        historyMemory,
        systemPrompts,
        chain,
        tools,
        longMemory,
        formatQuestionChain,
        enhancedSummary
    }: ChatLunaBrowsingChainInput & {
        chain: ChatHubLLMChain
        formatQuestionChain: ChatHubLLMChain
        tools: StructuredTool[]
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
        this.longMemory = longMemory
        this.historyMemory = historyMemory
        this.systemPrompts = systemPrompts
        this.responsePrompt = PromptTemplate.fromTemplate(RESPONSE_TEMPLATE)
        this.chain = chain
        this.tools = tools
    }

    static fromLLMAndTools(
        llm: ChatLunaChatModel,
        tools: Tool[],
        {
            botName,
            embeddings,
            historyMemory,
            systemPrompts,
            longMemory,
            enhancedSummary
        }: ChatLunaBrowsingChainInput
    ): ChatLunaBrowsingChain {
        const humanMessagePromptTemplate =
            HumanMessagePromptTemplate.fromTemplate('{input}')

        let conversationSummaryPrompt: HumanMessagePromptTemplate
        let messagesPlaceholder: MessagesPlaceholder

        if (historyMemory instanceof ConversationSummaryMemory) {
            conversationSummaryPrompt = HumanMessagePromptTemplate.fromTemplate(
                // eslint-disable-next-line max-len
                `This is some conversation between me and you. Please generate an response based on the system prompt and content below. Relevant pieces of previous conversation: {long_history} (You do not need to use these pieces of information if not relevant, and based on these information, generate similar but non-repetitive responses. Pay attention, you need to think more and diverge your creativity) Current conversation: {chat_history}`
            )
        } else {
            conversationSummaryPrompt = HumanMessagePromptTemplate.fromTemplate(
                // eslint-disable-next-line max-len
                `Relevant pieces of previous conversation: {long_history} (You do not need to use these pieces of information if not relevant, and based on these information, generate similar but non-repetitive responses. Pay attention, you need to think more and diverge your creativity.)`
            )

            messagesPlaceholder = new MessagesPlaceholder('chat_history')
        }
        const prompt = new ChatHubBrowsingPrompt({
            systemPrompts: systemPrompts ?? [
                new SystemMessage(
                    "You are ChatGPT, a large language model trained by OpenAI. Carefully heed the user's instructions."
                )
            ],
            conversationSummaryPrompt,
            messagesPlaceholder,
            tokenCounter: (text) => llm.getNumTokens(text),
            humanMessagePromptTemplate,
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
            historyMemory,
            systemPrompts,
            chain,
            tools,
            longMemory,
            enhancedSummary
        })
    }

    private _selectTool(name: string): StructuredTool {
        return this.tools.find((tool) => tool.name === name)
    }

    async fetchUrlContent(url: string, task: string) {
        const webTool = this._selectTool('web_browser')

        await webTool.invoke(`open ${url}`)

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
    }

    async call({
        message,
        stream,
        events,
        conversationId
    }: ChatHubLLMCallArg): Promise<ChainValues> {
        const requests: ChainValues = {
            input: message
        }

        const chatHistory = (
            await this.historyMemory.loadMemoryVariables(requests)
        )[this.historyMemory.memoryKey] as BaseMessage[]

        const longHistory = (
            await this.longMemory.loadMemoryVariables({
                user: message.content
            })
        )[this.longMemory.memoryKey]

        requests['long_history'] = longHistory
        requests['chat_history'] = chatHistory
        requests['id'] = conversationId

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

        requests['input'] = message.content

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

        await this.historyMemory.chatHistory.addMessage(message)
        await this.historyMemory.chatHistory.addAIChatMessage(finalResponse)

        await this.longMemory.saveContext(
            { user: message.content },
            { your: finalResponse }
        )

        const vectorStore = this.longMemory.vectorStoreRetriever.vectorStore

        if (vectorStore instanceof ChatLunaSaveableVectorStore) {
            logger?.debug('saving vector store')
            await vectorStore.save()
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
        const searchTool = this._selectTool('web_search')

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

const RESPONSE_TEMPLATE = `GOAL: Generate a concise, informative answer (max 250 words) based solely on the provided search results (URL and content).

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
