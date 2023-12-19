import { AIMessage, BaseMessage, ChainValues } from 'langchain/schema'
import { BufferMemory, ConversationSummaryMemory } from 'langchain/memory'
import {
    ChatHubLLMCallArg,
    ChatHubLLMChainWrapper,
    SystemPrompts
} from './base'
import { StructuredTool } from 'langchain/tools'
import { AgentExecutor } from 'langchain/agents'
import { ChatHubBaseEmbeddings, ChatLunaChatModel } from '../platform/model'
import { ChatHubTool } from '../platform/types'
import { Session } from 'koishi'
import { logger } from '../..'
import { OpenAIAgent } from '../agent/openai'

export interface ChatLunaPluginChainInput {
    systemPrompts?: SystemPrompts
    historyMemory: ConversationSummaryMemory | BufferMemory
    embeddings: ChatHubBaseEmbeddings
}

export class ChatLunaPluginChain
    extends ChatHubLLMChainWrapper
    implements ChatLunaPluginChainInput
{
    executor: AgentExecutor

    historyMemory: ConversationSummaryMemory | BufferMemory

    systemPrompts?: SystemPrompts

    llm: ChatLunaChatModel

    embeddings: ChatHubBaseEmbeddings

    activeTools: ChatHubTool[] = []

    tools: ChatHubTool[]

    constructor({
        historyMemory,
        systemPrompts,
        llm,
        tools,
        embeddings
    }: ChatLunaPluginChainInput & {
        tools: ChatHubTool[]
        llm: ChatLunaChatModel
    }) {
        super()

        this.historyMemory = historyMemory
        this.systemPrompts = systemPrompts
        this.tools = tools
        this.embeddings = embeddings
        this.llm = llm
    }

    static async fromLLMAndTools(
        llm: ChatLunaChatModel,
        tools: ChatHubTool[],
        { historyMemory, systemPrompts, embeddings }: ChatLunaPluginChainInput
    ): Promise<ChatLunaPluginChain> {
        return new ChatLunaPluginChain({
            historyMemory,
            systemPrompts,
            llm,
            embeddings,
            tools
        })
    }

    private async _createExecutor(
        llm: ChatLunaChatModel,
        tools: StructuredTool[],
        {
            historyMemory,
            systemPrompts
        }: Omit<ChatLunaPluginChainInput, 'embeddings'>
    ) {
        if (systemPrompts?.length > 1) {
            logger.warn(
                'Plugin chain does not support multiple system prompts. Only the first one will be used.'
            )
        }

        const executor = AgentExecutor.fromAgentAndTools({
            tags: ['openai-functions'],
            agent: OpenAIAgent.fromLLMAndTools(llm, tools, {
                prefix: systemPrompts?.[0].content as string
            }),
            tools,
            memory:
                historyMemory ??
                new BufferMemory({
                    returnMessages: true,
                    memoryKey: 'chat_history',
                    inputKey: 'input',
                    outputKey: 'output'
                }),
            verbose: true
        })

        return executor
    }

    private _getActiveTools(
        session: Session,
        messages: BaseMessage[]
    ): [ChatHubTool[], boolean] {
        const tools: ChatHubTool[] = this.activeTools

        const newActiveTools: [ChatHubTool, boolean][] = this.tools.map(
            (tool) => {
                const base = tool.selector(messages)

                if (tool.authorization) {
                    return [tool, tool.authorization(session) && base]
                }

                return [tool, base]
            }
        )

        const differenceTools = newActiveTools.filter((tool) => {
            const include = tools.includes(tool[0])

            return !include || (include && tool[1] === false)
        })

        if (differenceTools.length > 0) {
            for (const differenceTool of differenceTools) {
                if (differenceTool[1] === false) {
                    const index = tools.findIndex(
                        (tool) => tool === differenceTool[0]
                    )
                    if (index > -1) {
                        tools.splice(index, 1)
                    }
                } else {
                    tools.push(differenceTool[0])
                }
            }
            return [this.activeTools, true]
        }

        return [
            this.tools,
            this.tools.some((tool) => tool?.alwaysRecreate === true)
        ]
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
            input: message.content
        }

        const memoryVariables =
            await this.historyMemory.loadMemoryVariables(requests)

        requests['chat_history'] = memoryVariables[
            this.historyMemory.memoryKey
        ] as BaseMessage[]

        logger.debug(requests)

        requests['id'] = conversationId

        const [activeTools, recreate] = this._getActiveTools(
            session,
            requests['chat_history'].concat(message)
        )

        if (recreate || this.executor == null) {
            this.executor = await this._createExecutor(
                this.llm,
                await Promise.all(
                    activeTools.map((tool) =>
                        tool.createTool(
                            {
                                model: this.llm,
                                embeddings: this.embeddings
                            },
                            session
                        )
                    )
                ),
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
                    },
                    handleAgentAction(action, runId, parentRunId, tags) {
                        events?.['llm-call-tool'](action.tool, action.toolInput)
                    }
                }
            ]
        )

        await events?.['llm-used-token-count']?.(usedToken)

        const responseString = response.output

        const aiMessage = new AIMessage(responseString)
        response.message = aiMessage

        await this.historyMemory.chatHistory.addMessage(message)
        await this.historyMemory.chatHistory.addAIChatMessage(responseString)

        return response
    }

    get model() {
        return this.llm
    }
}
