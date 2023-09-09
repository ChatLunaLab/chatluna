import { AIMessage, BaseMessage, ChainValues, ChatGeneration, FunctionMessage, HumanMessage, SystemMessage } from 'langchain/schema'
import { BufferMemory, ConversationSummaryMemory, VectorStoreRetrieverMemory } from 'langchain/memory'

import { ChatHubLLMCallArg, ChatHubLLMChain, ChatHubLLMChainWrapper, SystemPrompts } from './base'
import { HumanMessagePromptTemplate, MessagesPlaceholder, SystemMessagePromptTemplate } from 'langchain/prompts'
import { MemoryVectorStore } from 'langchain/vectorstores/memory'
import { getEmbeddingContextSize, getModelContextSize } from '../utils/count_tokens'
import { ChatHubBrowsingPrompt, ChatHubOpenAIFunctionCallPrompt } from './prompt'
import { Embeddings } from 'langchain/embeddings/base'
import { ChatHubBrowsingAction, ChatHubBrowsingActionOutputParser } from './out_parsers'
import { TokenTextSplitter } from 'langchain/text_splitter'
import { StructuredTool, Tool } from 'langchain/tools'
import { ChatHubSaveableVectorStore } from '../model/base'
import { createLogger } from '../../utils/logger'
import { sleep } from 'koishi'
import { ChatHubChatModel } from '../platform/model'
import { ChatEvents } from '../../services/types'

const logger = createLogger()

export interface ChatHubFunctionCallBrowsingChainInput {
    botName: string
    systemPrompts?: SystemPrompts
    embeddings: Embeddings
    longMemory: VectorStoreRetrieverMemory
    historyMemory: ConversationSummaryMemory | BufferMemory
}

export class ChatHubFunctionCallBrowsingChain extends ChatHubLLMChainWrapper implements ChatHubFunctionCallBrowsingChainInput {
    botName: string

    embeddings: Embeddings

    searchMemory: VectorStoreRetrieverMemory

    chain: ChatHubLLMChain

    historyMemory: ConversationSummaryMemory | BufferMemory

    systemPrompts?: SystemPrompts

    longMemory: VectorStoreRetrieverMemory

    tools: StructuredTool[]

    constructor({
        botName,
        embeddings,
        historyMemory,
        systemPrompts,
        chain,
        tools,
        longMemory
    }: ChatHubFunctionCallBrowsingChainInput & {
        chain: ChatHubLLMChain
        tools: StructuredTool[]
    }) {
        super()
        this.botName = botName

        this.embeddings = embeddings

        // use memory
        this.searchMemory = new VectorStoreRetrieverMemory({
            vectorStoreRetriever: new MemoryVectorStore(embeddings).asRetriever(6),
            memoryKey: 'long_history',
            inputKey: 'input',
            outputKey: 'result',
            returnDocs: true
        })
        this.longMemory = longMemory
        this.historyMemory = historyMemory
        this.systemPrompts = systemPrompts
        this.chain = chain
        this.tools = tools
    }

    static fromLLMAndTools(
        llm: ChatHubChatModel,
        tools: Tool[],
        { botName, embeddings, historyMemory, systemPrompts, longMemory }: ChatHubFunctionCallBrowsingChainInput
    ): ChatHubFunctionCallBrowsingChain {
        const humanMessagePromptTemplate = HumanMessagePromptTemplate.fromTemplate('{input}')

        let conversationSummaryPrompt: SystemMessagePromptTemplate
        let messagesPlaceholder: MessagesPlaceholder

        if (historyMemory instanceof ConversationSummaryMemory) {
            conversationSummaryPrompt = SystemMessagePromptTemplate.fromTemplate(
                `This is some conversation between me and you. Please generate an response based on the system prompt and content below. Relevant pieces of previous conversation: {long_history} (You do not need to use these pieces of information if not relevant, and based on these information, generate similar but non-repetitive responses. Pay attention, you need to think more and diverge your creativity) Current conversation: {chat_history}`
            )
        } else {
            conversationSummaryPrompt = SystemMessagePromptTemplate.fromTemplate(
                `Relevant pieces of previous conversation: {long_history} (You do not need to use these pieces of information if not relevant, and based on these information, generate similar but non-repetitive responses. Pay attention, you need to think more and diverge your creativity.)`
            )

            messagesPlaceholder = new MessagesPlaceholder('chat_history')
        }
        const prompt = new ChatHubOpenAIFunctionCallPrompt({
            systemPrompts: systemPrompts ?? [new SystemMessage("You are ChatGPT, a large language model trained by OpenAI. Carefully heed the user's instructions.")],
            conversationSummaryPrompt,
            messagesPlaceholder,
            tokenCounter: (text) => llm.getNumTokens(text),
            humanMessagePromptTemplate,
            sendTokenLimit: llm.invocationParams().maxTokens ?? llm.getModelMaxContextSize()
        })

        const chain = new ChatHubLLMChain({ llm, prompt })

        return new ChatHubFunctionCallBrowsingChain({
            botName,
            embeddings,
            historyMemory,
            systemPrompts,
            chain,
            tools,
            longMemory
        })
    }

    private _selectTool(name: string): StructuredTool {
        return this.tools.find((tool) => tool.name === name)
    }

    async call({ message, stream, events, conversationId }: ChatHubLLMCallArg): Promise<ChainValues> {
        const requests: ChainValues = {
            input: message
        }

        const chatHistory = (await this.historyMemory.loadMemoryVariables(requests))[this.historyMemory.memoryKey] as BaseMessage[]

        const loopChatHistory = [...chatHistory]

        const longHistory = (
            await this.longMemory.loadMemoryVariables({
                user: message.content
            })
        )[this.longMemory.memoryKey]

        requests['long_history'] = longHistory
        requests['chat_history'] = loopChatHistory
        requests['id'] = conversationId

        let finalResponse: string

        let loopCount = 0

        while (true) {
            const response = await this.chain.call(
                {
                    ...requests,
                    tools: this.tools,
                    stream
                },
                [
                    {
                        handleLLMNewToken(token: string) {
                            events?.['llm-new-token']?.(token)
                        }
                    }
                ]
            )

            const rawGeneration = response['rawGeneration'] as ChatGeneration

            const responseMessage = rawGeneration.message

            logger.debug(`[ChatHubFunctionCallBrowsingChain] response: ${JSON.stringify(responseMessage)}`)

            if (loopCount == 0) {
                loopChatHistory.push(new HumanMessage(responseMessage.content))
                requests['input'] = undefined
            }

            loopChatHistory.push(responseMessage)

            if (responseMessage.additional_kwargs?.function_call) {
                const functionCall = responseMessage.additional_kwargs.function_call

                const tool = this._selectTool(functionCall.name)

                let toolResponse: {
                    name: string
                    content: string
                }

                try {
                    toolResponse = {
                        name: tool.name,
                        content: await tool.call(JSON.parse(functionCall.arguments))
                    }
                } catch (e) {
                    toolResponse = {
                        name: tool.name,
                        content: 'Call tool `' + functionCall.name + '` failed: ' + e
                    }
                }

                loopChatHistory.push(new FunctionMessage(toolResponse.content, toolResponse.name))
            } else {
                finalResponse = responseMessage.content
                break
            }

            if (loopCount > 10) {
                throw new Error('loop count > 10')
            }

            loopCount++
        }

        await this.historyMemory.saveContext({ input: message.content }, { output: finalResponse })

        await this.longMemory.saveContext({ user: message.content }, { your: finalResponse })

        const vectorStore = this.longMemory.vectorStoreRetriever.vectorStore

        if (vectorStore instanceof ChatHubSaveableVectorStore) {
            logger.debug('saving vector store')
            await vectorStore.save()
        }

        const aiMessage = new AIMessage(finalResponse)

        return {
            message: aiMessage
        }
    }

    get model() {
        return this.chain.llm
    }
}
