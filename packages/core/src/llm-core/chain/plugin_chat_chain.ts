import { AIMessage, ChainValues } from 'langchain/schema'
import { BufferMemory, ConversationSummaryMemory } from 'langchain/memory'
import { ChatHubLLMCallArg, ChatHubLLMChainWrapper, SystemPrompts } from './base'
import { Tool } from 'langchain/tools'
import { AgentExecutor, initializeAgentExecutorWithOptions } from 'langchain/agents'
import { createLogger } from '../../utils/logger'
import { ChatHubChatModel } from '../platform/model'

const logger = createLogger()

export interface ChatHubPluginChainInput {
    systemPrompts?: SystemPrompts
    historyMemory: ConversationSummaryMemory | BufferMemory
}

export class ChatHubPluginChain extends ChatHubLLMChainWrapper implements ChatHubPluginChainInput {
    executor: AgentExecutor

    historyMemory: ConversationSummaryMemory | BufferMemory

    systemPrompts?: SystemPrompts

    llm: ChatHubChatModel

    constructor({
        historyMemory,
        systemPrompts,
        executor,
        llm
    }: ChatHubPluginChainInput & {
        executor: AgentExecutor
        llm: ChatHubChatModel
    }) {
        super()

        this.historyMemory = historyMemory
        this.systemPrompts = systemPrompts
        this.executor = executor
        this.llm = llm
    }

    static async fromLLMAndTools(
        llm: ChatHubChatModel,
        tools: Tool[],
        { historyMemory, systemPrompts }: ChatHubPluginChainInput
    ): Promise<ChatHubPluginChain> {
        if (systemPrompts?.length > 1) {
            logger.warn(
                'Plugin chain does not support multiple system prompts. Only the first one will be used.'
            )
        }

        let executor: AgentExecutor

        if (llm._llmType() === 'openai' && llm._modelType().includes('0613')) {
            executor = await initializeAgentExecutorWithOptions(tools, llm, {
                verbose: true,
                agentType: 'openai-functions',
                agentArgs: {
                    prefix: systemPrompts?.[0].content
                },
                memory: historyMemory
            })
        } else {
            executor = await initializeAgentExecutorWithOptions(tools, llm, {
                verbose: true,
                agentType: 'chat-conversational-react-description',
                agentArgs: {
                    systemMessage: systemPrompts?.[0].content
                },
                memory: historyMemory
            })
        }

        return new ChatHubPluginChain({
            executor,
            historyMemory,
            systemPrompts,
            llm
        })
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

        const memoryVariables = await this.historyMemory.loadMemoryVariables(requests)

        requests['chat_history'] = memoryVariables[this.historyMemory.memoryKey]
        requests['id'] = conversationId

        const response = await this.executor.call({
            ...requests
        })

        const responseString = response.output

        const aiMessage = new AIMessage(responseString)
        response.message = aiMessage

        return response
    }

    get model() {
        return this.llm
    }
}
