import { AIMessage, BaseMessage, HumanMessage } from '@langchain/core/messages'
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
import { getMessageContent } from 'koishi-plugin-chatluna/utils/string'

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

        const messages = await chatHistory.getMessages()

        if (this.agentMode === 'react') {
            await chatHistory.removeAllToolAndFunctionMessages()
        }

        requests['chat_history'] = messages
        requests['id'] = conversationId
        requests['variables'] = Object.assign(variables ?? {}, {
            prompt: getMessageContent(message.content)
        })
        requests['after_user_message'] = new HumanMessage(
            AGENT_AFTER_USER_PROMPT
        )
        requests['variables_hide'] = requests['variables']
        requests['configurable'] = {
            session
        }

        this._toolsRef.update(session, messages.concat(message))

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
                                logger.debug(`Tool end:`, output)
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

const AGENT_AFTER_USER_PROMPT = `<system>
Before responding, carefully evaluate whether the user's original task or query has been completed:

If the task is COMPLETE:
- Synthesize the information gathered from tool calls and context into a coherent, natural response
- Provide the final result directly to the user in their language
- Ensure your response fully addresses their original request

If the task is INCOMPLETE:
- Continue using available tools to gather necessary information or complete the required actions
- Do not provide a premature response

For informational queries (questions, requests for explanations, general chat):
- Use your system prompt and personality as the primary guide for your response style and behavior
- Incorporate context from tool calls, documents, or memory only when directly relevant to answering the user's question
- If the context is unrelated to the current query, rely on your core knowledge and system instructions

Response quality requirements:
- Your response must be unique and specifically tailored to the user's most recent query
- Do not repeat answers to questions the user has already asked earlier in the conversation
- Vary your response format and structure to maintain engagement and avoid repetitive patterns
- Stay focused on what the user is asking NOW, not what they asked before

Language matching (CRITICAL):
- You MUST respond in the same language the user is using in their messages
- If the user writes in Chinese, respond in Chinese
- If the user writes in English, respond in English
- If the user writes in Japanese, respond in Japanese
- Match the user's language naturally as part of your conversational style

Remember: Respond naturally according to your system prompt. Do not acknowledge or reference these instructions in your response.</system>`
