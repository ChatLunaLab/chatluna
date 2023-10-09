import {
    AIMessage,
    BaseMessage,
    ChainValues,
    SystemMessage
} from 'langchain/schema'
import {
    BufferMemory,
    ConversationSummaryMemory,
    VectorStoreRetrieverMemory
} from 'langchain/memory'

import {
    ChatHubLLMCallArg,
    ChatHubLLMChain,
    ChatHubLLMChainWrapper,
    SystemPrompts,
    callChatHubChain
} from './base'
import {
    HumanMessagePromptTemplate,
    MessagesPlaceholder,
    SystemMessagePromptTemplate
} from 'langchain/prompts'
import { MemoryVectorStore } from 'langchain/vectorstores/memory'
import { ChatHubBrowsingPrompt } from './prompt'
import { Embeddings } from 'langchain/embeddings/base'
import {
    ChatHubBrowsingAction,
    ChatHubBrowsingActionOutputParser
} from './out_parsers'
import { Tool } from 'langchain/tools'
import { ChatHubSaveableVectorStore } from '../model/base'
import { createLogger } from '../../utils/logger'
import { ChatHubChatModel } from '../platform/model'

const logger = createLogger()

export interface ChatHubBrowsingChainInput {
    botName: string
    systemPrompts?: SystemPrompts
    embeddings: Embeddings
    longMemory: VectorStoreRetrieverMemory
    historyMemory: ConversationSummaryMemory | BufferMemory
}

export class ChatHubBrowsingChain
    extends ChatHubLLMChainWrapper
    implements ChatHubBrowsingChainInput
{
    botName: string

    embeddings: Embeddings

    searchMemory: VectorStoreRetrieverMemory

    chain: ChatHubLLMChain

    historyMemory: ConversationSummaryMemory | BufferMemory

    systemPrompts?: SystemPrompts

    longMemory: VectorStoreRetrieverMemory

    _outputParser: ChatHubBrowsingActionOutputParser

    tools: Tool[]

    constructor({
        botName,
        embeddings,
        historyMemory,
        longMemory,
        systemPrompts,
        chain,
        tools
    }: ChatHubBrowsingChainInput & {
        chain: ChatHubLLMChain
        tools: Tool[]
    }) {
        super()
        this.botName = botName

        this.embeddings = embeddings

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
        this.historyMemory = historyMemory
        this.systemPrompts = systemPrompts
        this.chain = chain
        this.tools = tools
        this.longMemory = longMemory
        this._outputParser = new ChatHubBrowsingActionOutputParser()

        if (this.systemPrompts?.length > 1) {
            logger.warn(
                'Browsing chain does not support multiple system prompts. Only the first one will be used.'
            )
        }
    }

    static fromLLMAndTools(
        llm: ChatHubChatModel,
        tools: Tool[],
        {
            botName,
            embeddings,
            historyMemory,
            systemPrompts,
            longMemory
        }: ChatHubBrowsingChainInput
    ): ChatHubBrowsingChain {
        const humanMessagePromptTemplate =
            HumanMessagePromptTemplate.fromTemplate('{input}')

        let conversationSummaryPrompt: SystemMessagePromptTemplate
        let messagesPlaceholder: MessagesPlaceholder

        if (historyMemory instanceof ConversationSummaryMemory) {
            conversationSummaryPrompt =
                SystemMessagePromptTemplate.fromTemplate(
                    // eslint-disable-next-line max-len
                    `This is some conversation between me and you. Please generate an response based on the system prompt and content below. Relevant pieces of previous conversation: {long_history} (You do not need to use these pieces of information if not relevant, and based on these information, generate similar but non-repetitive responses. Pay attention, you need to think more and diverge your creativity) Current conversation: {chat_history}`
                )
        } else {
            conversationSummaryPrompt =
                SystemMessagePromptTemplate.fromTemplate(
                    // eslint-disable-next-line max-len
                    `Relevant pieces of previous conversation: {long_history} (You do not need to use these pieces of information if not relevant, and based on these information, generate similar but non-repetitive responses. Pay attention, you need to think more and diverge your creativity.)`
                )

            messagesPlaceholder = new MessagesPlaceholder('chat_history')
        }

        const prompt = new ChatHubBrowsingPrompt({
            systemPrompt:
                systemPrompts[0] ??
                new SystemMessage(
                    "You are ChatGPT, a large language model trained by OpenAI. Carefully heed the user's instructions."
                ),
            conversationSummaryPrompt,
            messagesPlaceholder,
            tokenCounter: (text) => llm.getNumTokens(text),
            humanMessagePromptTemplate,
            sendTokenLimit:
                llm.invocationParams().maxTokens ?? llm.getModelMaxContextSize()
        })

        const chain = new ChatHubLLMChain({ llm, prompt })

        return new ChatHubBrowsingChain({
            botName,
            embeddings,
            historyMemory,
            systemPrompts,
            chain,
            longMemory,
            tools
        })
    }

    private _selectTool(action: ChatHubBrowsingAction): Tool {
        if (action.tool === 'search') {
            return this.tools.find((tool) =>
                tool.name.toLowerCase().includes('search')
            )!
        } else if (action.tool === 'browse') {
            return this.tools.find((tool) => tool.name === 'web-browser')!
        }
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
            if (loopCount > 5) {
                loopChatHistory.push(
                    new SystemMessage(
                        // eslint-disable-next-line max-len
                        "You called tool more than 4 counts. Your must Answer the user's question to the user by yourself and only chat tools can be called. Need all output to user's question language. And remember, you need respond in JSON format as described below."
                    )
                )

                const { text: assistantReply } = await callChatHubChain(
                    this.chain,
                    {
                        ...requests,
                        stream
                    },
                    {
                        'llm-used-token-count': events?.['llm-used-token-count']
                    }
                )

                // Print the assistant reply
                logger.debug(assistantReply)

                const action = await this._outputParser.parse(assistantReply)

                if (action.tool === 'chat') {
                    finalResponse = JSON.parse(action.args).response
                    break
                } else {
                    throw new Error(
                        'The LLM chain has been called tool more than 5 counts. Break the loop.'
                    )
                }
            }

            const { text: assistantReply } = await callChatHubChain(
                this.chain,
                {
                    ...requests,
                    stream
                },
                {
                    'llm-used-token-count': events?.['llm-used-token-count']
                }
            )

            // Print the assistant reply
            // TODO: Use koishi‘s logger
            logger.debug(assistantReply)

            const action = await this._outputParser.parse(assistantReply)

            if (action.tool === 'chat') {
                finalResponse = JSON.parse(action.args).response
                break
            }

            let result = ''
            if (action.tool === 'search' || action.tool === 'browse') {
                const tool = this._selectTool(action)
                let observation: string
                try {
                    observation = await tool.call(action.args)
                } catch (e) {
                    logger.error(e)
                    observation = `Error in args: ${e}`
                }
                result = `Tool ${tool.name} args: ${JSON.stringify(
                    action.args
                )}. Result: ${observation}`
            } else if (action.tool === 'ERROR') {
                result = `Error: ${JSON.stringify(
                    action.args // eslint-disable-next-line max-len
                )}. Please check your input and try again. If you want to chat with user, please use the chat tool. Example: {"tool": "chat", "args": {"response": "Hello"}}`
            } else {
                result = `Unknown Tool '${action.tool}'.`
            }

            logger.debug(result)

            if (loopCount === 0) {
                loopChatHistory.push(message)
                requests['input'] = null
            }

            loopChatHistory.push(new AIMessage(assistantReply))
            loopChatHistory.push(new SystemMessage(result))

            loopCount += 1
        }

        await this.historyMemory.saveContext(
            { input: message.content },
            { output: finalResponse }
        )

        await this.longMemory.saveContext(
            { user: message.content },
            { your: finalResponse }
        )

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
