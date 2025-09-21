import { AIMessage, BaseMessage } from '@langchain/core/messages'
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
import { ComputedRef } from '@vue/reactivity'

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

    tools: ComputedRef<ChatLunaTool[]>

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
        tools: ComputedRef<ChatLunaTool[]>
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
        tools: ComputedRef<ChatLunaTool[]>,
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
        const oldActiveTools: ChatLunaTool[] = this.activeTools

        const toolsRef = this.tools.value

        const newActiveTools: [ChatLunaTool, boolean][] = toolsRef.map(
            (tool) => {
                const base = tool.selector(messages)

                if (tool.authorization) {
                    return [tool, tool.authorization(session) && base]
                }

                return [tool, base]
            }
        )

        const differenceTools = newActiveTools.filter((newTool) => {
            const include = oldActiveTools.find(
                (oldTool) => oldTool.id === newTool[0].id
            )

            return !include || (include && newTool[1] === false)
        })

        if (differenceTools.length < 1) {
            return [toolsRef, oldActiveTools.length === toolsRef.length]
        }

        for (const differenceTool of differenceTools) {
            const index = oldActiveTools.findIndex(
                (tool) => tool.name === differenceTool[0].name
            )
            if (index > -1) {
                oldActiveTools.splice(index, 1)
            }

            if (differenceTool[1] === true) {
                oldActiveTools.push(differenceTool[0])
            }
        }

        return [oldActiveTools, true]
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
            logger.debug(
                `Recreate executor: %s`,
                activeTools.map((tool) => `[${tool.name}]:${tool.id}`).join(' ')
            )

            const tools = activeTools.map((tool) =>
                tool.createTool({
                    embeddings: this.embeddings
                })
            )

            this.executor = await this._createExecutor(this.llm, tools)

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

        return response
    }

    get model() {
        return this.llm
    }
}
