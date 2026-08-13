import { CallbackManager } from '@langchain/core/callbacks/manager'
import { BaseMessage } from '@langchain/core/messages'
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
    AgentAction,
    AgentRunContext,
    AgentRunner,
    createAgentRunner,
    createToolsRef,
    ToolMask
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
import {
    getMessageContent,
    sanitizeToolLogValue
} from 'koishi-plugin-chatluna/utils/string'
import type { ChatLunaContextManagerService } from 'koishi-plugin-chatluna/llm-core/prompt'

export interface ChatLunaPluginChainInput {
    prompt: ChatLunaChatPrompt
    historyMemory: BufferMemory
    embeddings: ChatLunaBaseEmbeddings
    agentMode?: 'tool-calling' | 'react'
    variableService: ChatLunaPromptRenderService
    preset: ComputedRef<PresetTemplate>
    contextManager: ChatLunaContextManagerService
    toolMask?: ToolMask
}

export class ChatLunaPluginChain
    extends ChatLunaLLMChainWrapper
    implements ChatLunaPluginChainInput
{
    runner: ComputedRef<AgentRunner>

    historyMemory: BufferMemory

    systemPrompts?: SystemPrompts

    llm: ChatLunaChatModel

    embeddings: ChatLunaBaseEmbeddings

    tools: ComputedRef<ChatLunaTool[]>

    variableService: ChatLunaPromptRenderService

    prompt: ChatLunaChatPrompt

    preset: ComputedRef<PresetTemplate>

    contextManager: ChatLunaContextManagerService

    agentMode?: 'tool-calling' | 'react'

    toolMask?: ToolMask

    private _toolsRef: ReturnType<typeof createToolsRef>

    constructor({
        historyMemory,
        prompt,
        llm,
        tools,
        preset,
        embeddings,
        agentMode,
        contextManager,
        toolMask
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
        this.contextManager = contextManager
        this.toolMask = toolMask

        this._toolsRef = createToolsRef({
            tools: this.tools,
            embeddings: this.embeddings,
            toolMask: this.toolMask
        })

        this.runner = this._createRunner()
    }

    static fromLLMAndTools(
        llm: ChatLunaChatModel,
        tools: ComputedRef<ChatLunaTool[]>,
        {
            historyMemory,
            preset,
            embeddings,
            agentMode,
            variableService,
            contextManager,
            toolMask
        }: Omit<ChatLunaPluginChainInput, 'prompt'>
    ): ChatLunaPluginChain {
        const prompt = new ChatLunaChatPrompt({
            preset,
            tokenCounter: (text) => llm.getNumTokens(text),
            promptRenderService: variableService,
            contextManager,
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
            variableService,
            contextManager,
            toolMask
        })
    }

    private _createRunner() {
        return createAgentRunner({
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

    async call(arg: ChatLunaLLMCallArg): Promise<ChainValues> {
        const ctx = {
            kind: 'main',
            agentId: arg.conversationId,
            agentName:
                this.preset.value.triggerKeyword[0] ?? arg.conversationId,
            conversationId: arg.conversationId,
            requestId: arg.requestId,
            source: arg.source ?? 'chatluna',
            userId: arg.session.userId,
            guildId: arg.session.guildId,
            channelId: arg.session.channelId,
            toolMask: arg.toolMask
        } satisfies AgentRunContext

        const requests: ChainValues & {
            chat_history?: BaseMessage[]
            id?: string
            session?: Session
        } = {
            input: arg.message
        }
        const nextVars = Object.assign({}, arg.variables ?? {})
        const toolMask = ctx.toolMask

        const chatHistory = this.historyMemory
            .chatHistory as KoishiChatMessageHistory
        const preset = this.preset.value
        const messages = await chatHistory.getMessages()
        const history =
            this.agentMode === 'react'
                ? await chatHistory.removeAllToolAndFunctionMessages()
                : messages

        requests['chat_history'] = [...history]
        requests['id'] = ctx.conversationId
        requests['variables'] = Object.assign(nextVars, {
            prompt: getMessageContent(arg.message.content)
        })
        requests['variables']['built'] = {
            conversationId: ctx.conversationId,
            requestId: ctx.requestId,
            userId: ctx.userId,
            guildId: ctx.guildId,
            channelId: ctx.channelId,
            chatPlatform: arg.session.platform
        }
        requests['variables_hide'] = requests['variables']
        requests['configurable'] = {
            session: arg.session,
            agentContext: ctx
        }

        this._toolsRef.update(
            arg.session,
            messages.concat(arg.message),
            toolMask
        )

        const runner = this.runner.value.withConfig({
            configurable: {
                messageQueue: arg.messageQueue,
                onAgentEvent: arg.onAgentEvent,
                agentContext: ctx
            }
        })

        let usedToken = 0
        let response: ChainValues | undefined
        let error

        const request = () => {
            const manager =
                CallbackManager.configure(arg.callbacks) ??
                new CallbackManager()

            manager.addHandler(
                CallbackManager.fromHandlers({
                    async handleLLMEnd(out) {
                        usedToken +=
                            out.llmOutput?.usage_metadata?.total_tokens ?? 0
                    },
                    async handleAgentAction(action: AgentAction) {
                        await arg.events?.['llm-call-tool']?.(
                            action.tool,
                            action.toolInput,
                            action.content,
                            action.log
                        )
                    },
                    async handleToolEnd(out) {
                        logger.debug('Tool end:', sanitizeToolLogValue(out))
                    },
                    async handleLLMNewToken(token) {
                        await arg.events?.['llm-new-token']?.(token)
                    },
                    async handleCustomEvent(name, data) {
                        if (name === 'LLMNewChunk') {
                            await arg.events?.['llm-new-chunk']?.(data)
                        }
                    }
                }).handlers[0]
            )

            return runner.invoke(
                {
                    ...requests,
                    maxTokens: arg.maxToken,
                    maxTokenLimit: arg.maxTokenLimit
                },
                {
                    signal: arg.signal,
                    callbacks: manager,
                    metadata: { chatlunaAgent: ctx },
                    configurable: {
                        session: arg.session,
                        model: this.llm,
                        preset: preset.triggerKeyword[0],
                        agentContext: ctx
                    }
                }
            )
        }

        for (let i = 0; i < 3; i++) {
            if (arg.signal?.aborted) {
                throw (
                    arg.signal.reason ??
                    new ChatLunaError(ChatLunaErrorCode.ABORTED)
                )
            }

            try {
                response = await request()
                break
            } catch (e) {
                if (
                    e instanceof ChatLunaError &&
                    e.errorCode === ChatLunaErrorCode.ABORTED
                ) {
                    throw e
                }

                if ((e as Error)?.message?.includes('Aborted')) {
                    throw new ChatLunaError(ChatLunaErrorCode.ABORTED)
                }

                logger.error(e)
                error = e
            }
        }

        await arg.events?.['llm-used-token-count']?.(usedToken)

        if (error != null && response == null) {
            if (error instanceof ChatLunaError) {
                throw error
            } else {
                throw new ChatLunaError(
                    ChatLunaErrorCode.API_REQUEST_FAILED,
                    error
                )
            }
        }

        if (response == null) {
            throw new ChatLunaError(ChatLunaErrorCode.API_REQUEST_FAILED)
        }

        return response
    }

    get model() {
        return this.llm
    }
}
