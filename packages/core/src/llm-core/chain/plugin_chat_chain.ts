import { AIMessage, BaseMessage, ChainValues } from 'langchain/schema'
import { BufferMemory, ConversationSummaryMemory } from 'langchain/memory'
import {
    ChatHubLLMCallArg,
    ChatHubLLMChainWrapper,
    SystemPrompts
} from './base'
import { Tool } from 'langchain/tools'
import {
    AgentExecutor,
    initializeAgentExecutorWithOptions
} from 'langchain/agents'
import { ChatHubChatModel } from '../platform/model'
import { ChatHubTool } from '../platform/types'
import { Session } from 'koishi'
import { logger } from '../..'

export interface ChatHubPluginChainInput {
    systemPrompts?: SystemPrompts
    historyMemory: ConversationSummaryMemory | BufferMemory
}

export class ChatHubPluginChain
    extends ChatHubLLMChainWrapper
    implements ChatHubPluginChainInput
{
    executor: AgentExecutor

    historyMemory: ConversationSummaryMemory | BufferMemory

    systemPrompts?: SystemPrompts

    llm: ChatHubChatModel

    activeTools: ChatHubTool[]

    tools: ChatHubTool[]

    constructor({
        historyMemory,
        systemPrompts,
        llm,
        tools
    }: ChatHubPluginChainInput & {
        tools: ChatHubTool[]
        llm: ChatHubChatModel
    }) {
        super()

        this.historyMemory = historyMemory
        this.systemPrompts = systemPrompts
        this.tools = tools
        this.llm = llm
    }

    static async fromLLMAndTools(
        llm: ChatHubChatModel,
        tools: ChatHubTool[],
        { historyMemory, systemPrompts }: ChatHubPluginChainInput
    ): Promise<ChatHubPluginChain> {
        return new ChatHubPluginChain({
            historyMemory,
            systemPrompts,
            llm,
            tools
        })
    }

    private async _createExecutor(
        llm: ChatHubChatModel,
        tools: Tool[],
        { historyMemory, systemPrompts }: ChatHubPluginChainInput
    ) {
        if (systemPrompts?.length > 1) {
            logger.warn(
                'Plugin chain does not support multiple system prompts. Only the first one will be used.'
            )
        }

        if (
            this.llm._llmType() === 'openai' &&
            llm._modelType().includes('0613')
        ) {
            return await initializeAgentExecutorWithOptions(tools, llm, {
                verbose: true,
                agentType: 'openai-functions',
                agentArgs: {
                    prefix: systemPrompts?.[0].content
                },
                memory: historyMemory
            })
        } else {
            return await initializeAgentExecutorWithOptions(tools, llm, {
                verbose: true,
                agentType: 'chat-conversational-react-description',
                agentArgs: {
                    systemMessage: systemPrompts?.[0].content
                },
                memory: historyMemory
            })
        }
    }

    private _getActiveTools(
        session: Session,
        messages: BaseMessage[]
    ): [ChatHubTool[], boolean] {
        const tools: ChatHubTool[] = this.activeTools

        const newActiveTools: ChatHubTool[] = tools.filter((tool) => {
            const base = tool.selector(messages)
            if (tool.authorization) {
                return tool.authorization(session) && base
            }

            return base
        })

        const differenceTools = newActiveTools.filter(
            (tool) => !tools.includes(tool)
        )

        if (differenceTools.length > 0) {
            this.activeTools = this.activeTools.concat(differenceTools)

            return [this.activeTools, true]
        }

        return [this.tools, false]
    }

    async call({
        message,
        stream,
        session,
        events,
        conversationId
    }: ChatHubLLMCallArg): Promise<ChainValues> {
        const requests: ChainValues & {
            chat_history?: BaseMessage[]
            id?: string
        } = {
            input: message
        }

        const memoryVariables =
            await this.historyMemory.loadMemoryVariables(requests)

        requests['chat_history'] = memoryVariables[
            this.historyMemory.memoryKey
        ] as BaseMessage[]
        requests['id'] = conversationId

        const [activeTools, recreate] = this._getActiveTools(
            session,
            requests['chat_history'].concat(message)
        )

        if (recreate) {
            this.executor = await this._createExecutor(
                this.llm,
                activeTools.map((tool) => tool.tool),
                {
                    historyMemory: this.historyMemory,
                    systemPrompts: this.systemPrompts
                }
            )
        }

        let usedToken = 0

        const response = await this.executor.call(
            {
                ...requests
            },
            [
                {
                    handleLLMEnd(output, runId, parentRunId, tags) {
                        usedToken += output.llmOutput?.tokenUsage?.totalTokens
                    }
                }
            ]
        )

        await events?.['llm-used-token-count']?.(usedToken)

        const responseString = response.output

        const aiMessage = new AIMessage(responseString)
        response.message = aiMessage

        return response
    }

    get model() {
        return this.llm
    }
}
