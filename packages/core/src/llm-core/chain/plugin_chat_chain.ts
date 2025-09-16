import { AIMessage, BaseMessage, ToolMessage } from '@langchain/core/messages'
import { StructuredTool } from '@langchain/core/tools'
import { ChainValues } from '@langchain/core/utils/types'
import { Session } from 'koishi'
import {
    ChatLunaLLMCallArg,
    ChatLunaLLMChainWrapper,
    SystemPrompts
} from 'koishi-plugin-chatluna/llm-core/chain/base'
import {
    ChatLunaBaseEmbeddings,
    ChatLunaChatModel
} from 'koishi-plugin-chatluna/llm-core/platform/model'
import { ChatLunaTool } from 'koishi-plugin-chatluna/llm-core/platform/types'
import {
    AgentExecutor,
    AgentStep,
    createOpenAIAgent,
    createReactAgent
} from 'koishi-plugin-chatluna/llm-core/agent'
import { BufferMemory } from 'koishi-plugin-chatluna/llm-core/memory/langchain'
import { logger } from '../..'
import {
    ChatLunaError,
    ChatLunaErrorCode
} from 'koishi-plugin-chatluna/utils/error'
import { PresetTemplate } from 'koishi-plugin-chatluna/llm-core/prompt'
import { ChatLunaChatPrompt } from 'koishi-plugin-chatluna/llm-core/chain/prompt'
import type { ChatLunaVariableService } from 'koishi-plugin-chatluna/services/chat'
import { KoishiChatMessageHistory } from 'koishi-plugin-chatluna/llm-core/memory/message'

export interface ChatLunaPluginChainInput {
    prompt: ChatLunaChatPrompt
    historyMemory: BufferMemory
    embeddings: ChatLunaBaseEmbeddings
    agentMode?: 'tool-calling' | 'react'
    variableService: ChatLunaVariableService
    preset: () => Promise<PresetTemplate>
}

export class ChatLunaPluginChain
    extends ChatLunaLLMChainWrapper
    implements ChatLunaPluginChainInput
{
    executor: AgentExecutor

    historyMemory: BufferMemory

    systemPrompts?: SystemPrompts

    llm: ChatLunaChatModel

    embeddings: ChatLunaBaseEmbeddings

    activeTools: ChatLunaTool[] = []

    tools: ChatLunaTool[]

    baseMessages: BaseMessage[] = undefined

    variableService: ChatLunaVariableService

    prompt: ChatLunaChatPrompt

    preset: () => Promise<PresetTemplate>

    agentMode?: 'tool-calling' | 'react'

    constructor({
        historyMemory,
        prompt,
        llm,
        tools,
        preset,
        embeddings,
        agentMode
    }: ChatLunaPluginChainInput & {
        tools: ChatLunaTool[]
        llm: ChatLunaChatModel
    }) {
        super()

        this.historyMemory = historyMemory
        this.prompt = prompt
        this.tools = tools
        this.embeddings = embeddings
        this.llm = llm
        this.agentMode = agentMode ?? 'react'

        this.preset = preset
    }

    static fromLLMAndTools(
        llm: ChatLunaChatModel,
        tools: ChatLunaTool[],
        {
            historyMemory,
            preset,
            embeddings,
            agentMode,
            variableService
        }: Omit<ChatLunaPluginChainInput, 'prompt'>
    ): ChatLunaPluginChain {
        const prompt = new ChatLunaChatPrompt({
            preset,
            tokenCounter: (text) => llm.getNumTokens(text),
            variableService,
            sendTokenLimit:
                llm.invocationParams().maxTokenLimit ??
                llm.getModelMaxContextSize()
        })

        return new ChatLunaPluginChain({
            historyMemory,
            prompt,
            llm,
            agentMode,
            embeddings,
            tools,
            preset,
            variableService
        })
    }

    private async _createExecutor(
        llm: ChatLunaChatModel,
        tools: StructuredTool[]
    ) {
        if (this.agentMode === 'react') {
            return AgentExecutor.fromAgentAndTools({
                tags: ['react'],
                agent: await createReactAgent({
                    llm,
                    tools,
                    prompt: this.prompt,
                    instructions: await this.preset().then((preset) => {
                        return preset.config.reActInstruction
                    })
                }),
                tools,
                memory: undefined,
                verbose: false,
                returnIntermediateSteps: false,
                handleParsingErrors: true
            })
        }

        return AgentExecutor.fromAgentAndTools({
            tags: ['tool-calling'],
            agent: createOpenAIAgent({
                llm,
                tools,
                prompt: this.prompt
            }),
            tools,
            returnIntermediateSteps: true,
            memory: undefined,
            verbose: false
        })
    }

    private _getActiveTools(
        session: Session,
        messages: BaseMessage[]
    ): [ChatLunaTool[], boolean] {
        const tools: ChatLunaTool[] = this.activeTools

        const newActiveTools: [ChatLunaTool, boolean][] = this.tools.map(
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

        return [this.tools, false]
    }

    async call({
        message,
        signal,
        session,
        events,
        conversationId,
        variables,
        maxToken
    }: ChatLunaLLMCallArg): Promise<ChainValues> {
        const requests: ChainValues & {
            chat_history?: BaseMessage[]
            id?: string
            session?: Session
        } = {
            input: message
        }

        const chatHistory = this.historyMemory
            .chatHistory as KoishiChatMessageHistory

        if (this.agentMode === 'react') {
            await chatHistory.removeAllToolAndFunctionMessages()
        }

        this.baseMessages = await chatHistory.getMessages()

        requests['chat_history'] = this.baseMessages

        requests['id'] = conversationId
        requests['variables'] = variables ?? {}

        const [activeTools, recreate] = this._getActiveTools(
            session,
            this.baseMessages.concat(message)
        )
        const preset = await this.preset()

        if (recreate || this.executor == null) {
            const tools = activeTools.map((tool) =>
                tool.createTool({
                    embeddings: this.embeddings
                })
            )

            this.executor = await this._createExecutor(
                this.llm,
                await Promise.all(tools)
            )

            this.baseMessages =
                await this.historyMemory.chatHistory.getMessages()

            requests['chat_history'] = this.baseMessages
        }

        let usedToken = 0

        let response: ChainValues

        const request = () => {
            return this.executor.invoke(
                {
                    ...requests,

                    maxTokens: maxToken
                },
                {
                    signal,
                    callbacks: [
                        {
                            handleLLMEnd(output) {
                                usedToken +=
                                    output.llmOutput?.tokenUsage?.totalTokens ??
                                    0
                            },

                            handleAgentAction(action) {
                                events?.['llm-call-tool'](
                                    action.tool,
                                    action.toolInput,
                                    action.log
                                )
                            },

                            handleToolEnd(output, runId, parentRunId, tags) {
                                logger.debug(`tool end: ${output}`)
                            },

                            handleLLMNewToken(token) {
                                events?.['llm-new-token']?.(token)
                            },

                            handleCustomEvent(
                                eventName,
                                data,
                                runId,
                                tags,
                                metadata
                            ) {
                                if (eventName === 'LLMNewChunk') {
                                    events?.['llm-new-chunk']?.(data)
                                }
                            }
                        }
                    ],
                    configurable: {
                        session,
                        model: this.llm,
                        conversationId,
                        preset: preset.triggerKeyword[0],
                        userId: session.userId
                    }
                }
            )
        }

        let error
        for (let i = 0; i < 3; i++) {
            if (signal.aborted) {
                throw new ChatLunaError(ChatLunaErrorCode.ABORTED)
            }
            try {
                response = await request()
                break
            } catch (e) {
                if (e.message.includes('Aborted')) {
                    throw new ChatLunaError(ChatLunaErrorCode.ABORTED)
                }
                logger.error(e)
                error = e
            }
        }

        await events?.['llm-used-token-count']?.(usedToken)

        if (error && response == null) {
            if (error instanceof ChatLunaError) {
                throw error
            } else {
                throw new ChatLunaError(
                    ChatLunaErrorCode.API_REQUEST_FAILED,
                    error
                )
            }
        }

        response.message = new AIMessage(response.output)

        if (response['parallelIntermediateSteps']) {
            const intermediateSteps = response[
                'parallelIntermediateSteps'
            ] as AgentStep[][]

            // 抢先添加工具调用

            for (const parallelSteps of intermediateSteps) {
                await chatHistory.addMessage(
                    new AIMessage({
                        content: '',
                        tool_calls: parallelSteps.map((step) => ({
                            id: step.action.toolCallId,
                            name: step.action.tool,
                            args:
                                typeof step.action.toolInput !== 'string'
                                    ? step.action.toolInput
                                    : { input: step.action.toolInput }
                        }))
                    })
                )

                for (const step of parallelSteps) {
                    await chatHistory.addMessage(
                        new ToolMessage({
                            content: step.observation,
                            tool_call_id: step.action.toolCallId,
                            name: step.action.tool
                        })
                    )
                }
            }
        }

        return response
    }

    get model() {
        return this.llm
    }
}
