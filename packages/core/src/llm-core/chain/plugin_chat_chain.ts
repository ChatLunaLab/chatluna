import { AIMessage, BaseMessage } from '@langchain/core/messages'
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
    createAgentExecutor,
    createToolsRef
} from 'koishi-plugin-chatluna/llm-core/agent'
import { BufferMemory } from 'koishi-plugin-chatluna/llm-core/memory/langchain'
import { logger } from 'koishi-plugin-chatluna'
import {
    ChatLunaError,
    ChatLunaErrorCode
} from 'koishi-plugin-chatluna/utils/error'
import { PresetTemplate } from 'koishi-plugin-chatluna/llm-core/prompt'
import { ChatLunaChatPrompt } from 'koishi-plugin-chatluna/llm-core/chain/prompt'
import type { ChatLunaPromptRenderService } from 'koishi-plugin-chatluna/services/chat'
import { KoishiChatMessageHistory } from 'koishi-plugin-chatluna/llm-core/memory/message'
import { computed, ComputedRef } from '@vue/reactivity'

export interface ChatLunaPluginChainInput {
    prompt: ChatLunaChatPrompt
    historyMemory: BufferMemory
    embeddings: ChatLunaBaseEmbeddings
    agentMode?: 'tool-calling' | 'react'
    variableService: ChatLunaPromptRenderService
    preset: ComputedRef<PresetTemplate>
}

export class ChatLunaPluginChain
    extends ChatLunaLLMChainWrapper
    implements ChatLunaPluginChainInput
{
    executor: ReturnType<typeof createAgentExecutor>

    historyMemory: BufferMemory

    systemPrompts?: SystemPrompts

    llm: ChatLunaChatModel

    embeddings: ChatLunaBaseEmbeddings

    tools: ComputedRef<ChatLunaTool[]>

    baseMessages: BaseMessage[] = undefined

    variableService: ChatLunaPromptRenderService

    prompt: ChatLunaChatPrompt

    preset: ComputedRef<PresetTemplate>

    agentMode?: 'tool-calling' | 'react'

    private _toolsRef: ReturnType<typeof createToolsRef>

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

        this._toolsRef = createToolsRef({
            tools: this.tools,
            embeddings: this.embeddings
        })

        this.executor = this._createExecutor()
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
            promptRenderService: variableService,
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

    private _createExecutor() {
        return createAgentExecutor({
            llm: computed(() => this.llm),
            tools: this._toolsRef.tools,
            prompt: this.prompt,
            agentMode: this.agentMode,
            returnIntermediateSteps: this.agentMode === 'tool-calling',
            handleParsingErrors: true,
            instructions: computed(() => {
                if (this.agentMode === 'react') {
                    return this.preset.value.config.reActInstruction
                }
                return undefined
            })
        })
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

        requests['chat_history'] = await chatHistory.getMessages()
        requests['id'] = conversationId
        requests['variables'] = variables ?? {}

        this._toolsRef.update(session, this.baseMessages.concat(message))

        const preset = this.preset.value

        let usedToken = 0
        let response: ChainValues

        const request = () => {
            return this.executor.value.invoke(
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
