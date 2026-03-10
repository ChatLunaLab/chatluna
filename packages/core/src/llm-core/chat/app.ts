import { BaseChatMessageHistory } from '@langchain/core/chat_history'
import { Embeddings } from '@langchain/core/embeddings'
import { ChainValues } from '@langchain/core/utils/types'
import { Context, Session } from 'koishi'
import { parseRawModelName } from 'koishi-plugin-chatluna/llm-core/utils/count_tokens'
import { BufferMemory } from 'koishi-plugin-chatluna/llm-core/memory/langchain'
import { logger } from 'koishi-plugin-chatluna'
import { ConversationRoom } from '../../types'
import {
    ChatLunaError,
    ChatLunaErrorCode
} from 'koishi-plugin-chatluna/utils/error'
import { ChatLunaLLMCallArg, ChatLunaLLMChainWrapper } from '../chain/base'
import { KoishiChatMessageHistory } from 'koishi-plugin-chatluna/llm-core/memory/message'
import { emptyEmbeddings } from 'koishi-plugin-chatluna/llm-core/model/in_memory'
import {
    PlatformEmbeddingsClient,
    PlatformModelAndEmbeddingsClient,
    PlatformModelClient
} from 'koishi-plugin-chatluna/llm-core/platform/client'
import { ChatLunaChatModel } from 'koishi-plugin-chatluna/llm-core/platform/model'
import { PlatformService } from 'koishi-plugin-chatluna/llm-core/platform/service'
import {
    ModelCapabilities,
    ModelInfo
} from 'koishi-plugin-chatluna/llm-core/platform/types'
import { AIMessage, HumanMessage } from '@langchain/core/messages'
import { PresetTemplate } from 'koishi-plugin-chatluna/llm-core/prompt'
import { getMessageContent } from 'koishi-plugin-chatluna/utils/string'
import type { HandlerResult } from '../../utils/types'
import { computed, ComputedRef } from '@vue/reactivity'
import type { CompressContextResult } from './infinite_context'
import { InfiniteContextManager } from './infinite_context'

export class ChatInterface {
    private _input: ChatInterfaceInput
    private _chatHistory: KoishiChatMessageHistory
    private _chain: ComputedRef<ChatLunaLLMChainWrapper | undefined> | undefined
    private _embeddings: ComputedRef<Embeddings>

    private _historyMemory?: BufferMemory
    private _infiniteContextManager?: InfiniteContextManager

    private _chatCount = 0

    constructor(
        public ctx: Context,
        input: ChatInterfaceInput
    ) {
        this._input = input
        ctx.on('dispose', () => {
            this._chain = undefined
            this._embeddings = undefined
            this._historyMemory = undefined
            this._infiniteContextManager = undefined
        })
    }

    private async handleChatError(
        arg: ChatLunaLLMCallArg,
        wrapper: ChatLunaLLMChainWrapper | undefined,
        error: unknown,
        throwError = true
    ): Promise<never | void> {
        await this.ctx.parallel(
            'chatluna/after-chat-error',
            error as unknown as Error,
            arg.conversationId,
            arg.message,
            arg.variables,
            this,
            wrapper,
            arg.requestId
        )

        if (!throwError) {
            return
        }

        if (
            error instanceof ChatLunaError &&
            error.errorCode === ChatLunaErrorCode.API_UNSAFE_CONTENT
        ) {
            throw error
        }

        if (error instanceof ChatLunaError) {
            throw error
        }

        throw new ChatLunaError(ChatLunaErrorCode.UNKNOWN_ERROR, error as Error)
    }

    async chat(arg: ChatLunaLLMCallArg): Promise<ChainValues> {
        let wrapper: ChatLunaLLMChainWrapper

        try {
            wrapper = await this.getChatLunaLLMChainWrapper()
        } catch (error) {
            await this.handleChatError(arg, wrapper, error)
            throw error
        }

        try {
            await this.ctx.parallel(
                'chatluna/before-chat',
                arg.conversationId,
                arg.message,
                arg.variables,
                this,
                arg.session
            )
        } catch (error) {
            logger.error('Something went wrong when calling before-chat hook:')
            logger.error(error)
        }

        try {
            const additionalArgs = await this._chatHistory.getAdditionalArgs()

            arg.variables = arg.variables ?? {}

            if (arg.postHandler?.variables) {
                for (const key in arg.postHandler.variables) {
                    arg.variables[key] = ''
                }
            }

            arg.variables = { ...additionalArgs, ...arg.variables }

            const response = await this.processChat(arg, wrapper)

            return response
        } catch (error) {
            await this.handleChatError(arg, wrapper, error)
        }
    }

    private async processChat(
        arg: ChatLunaLLMCallArg,
        wrapper: ChatLunaLLMChainWrapper
    ): Promise<ChainValues> {
        let hasSavedUser = false

        const saveUser = async () => {
            if (hasSavedUser) {
                return
            }

            await this._chatHistory.addMessage(arg.message)
            hasSavedUser = true
        }

        try {
            if (this.ctx.chatluna.currentConfig.infiniteContext) {
                const manager = this._ensureInfiniteContextManager()
                await manager?.compressIfNeeded(wrapper)
            }
        } catch (error) {
            logger.error('Error compressing context:', error)
        }

        const response = (await wrapper.call({
            ...arg,
            maxToken: this.preset?.value?.config?.maxOutputToken,
            messageQueue: arg.messageQueue,
            onAgentEvent: async (event) => {
                if (event.type === 'tool-result') {
                    await saveUser()
                    await this._chatHistory.addAgentToolBatch(event.steps)
                }

                if (event.type === 'human-update') {
                    await saveUser()
                    await this._chatHistory.addMessages(event.messages)
                }

                await arg.onAgentEvent?.(event)
            }
        })) as {
            message: AIMessage
        } & ChainValues

        const responseMessage = response.message

        const displayResponse = new AIMessage({
            content: responseMessage.content
        })

        displayResponse.additional_kwargs = responseMessage.additional_kwargs

        this._chatCount++

        // Handle post-processing if needed
        if (arg.postHandler) {
            const handlerResult = await this.handlePostProcessing(
                arg,
                displayResponse
            )
            displayResponse.content = handlerResult.displayContent
            await this._chatHistory.overrideAdditionalArgs(
                handlerResult.variables
            )
        }

        const messageContent = getMessageContent(displayResponse.content)

        // Update chat history
        if (messageContent.trim().length > 0) {
            await saveUser()
            let saveMessage = responseMessage
            if (!this.ctx.chatluna.currentConfig.rawOnCensor) {
                saveMessage = displayResponse
            }

            await this._chatHistory.addMessage(saveMessage)
        }

        // Process response
        try {
            await this.ctx.parallel(
                'chatluna/after-chat',
                arg.conversationId,
                arg.message,
                displayResponse as AIMessage,
                { ...arg.variables, chatCount: this._chatCount },
                this,
                arg.session
            )
        } catch (error) {
            await this.handleChatError(arg, wrapper, error, false)
        }

        return { message: displayResponse }
    }

    private async handlePostProcessing(
        arg: ChatLunaLLMCallArg,
        message: AIMessage
    ): Promise<HandlerResult> {
        logger.debug(`Original content: %c`, message.content)

        return await arg.postHandler.handler(
            arg.session,
            getMessageContent(message.content)
        )
    }

    async getChatLunaLLMChainWrapper(): Promise<ChatLunaLLMChainWrapper> {
        if (this._chain) {
            const chainValue = this._chain.value
            if (chainValue) {
                return chainValue
            }
        }

        await this.createChatLunaLLMChainWrapper()
        return this._chain.value
    }

    async createChatLunaLLMChainWrapper(): Promise<void> {
        if (this._chain) {
            return
        }

        const service = this.ctx.chatluna.platform
        const [llmPlatform, llmModelName] = parseRawModelName(this._input.model)

        let llm: ComputedRef<ChatLunaChatModel>

        let modelInfo: ComputedRef<ModelInfo>
        let historyMemory: BufferMemory

        try {
            this._embeddings = await this._initEmbeddings(service)
        } catch (error) {
            if (error instanceof ChatLunaError) {
                throw error
            }
            throw new ChatLunaError(
                ChatLunaErrorCode.EMBEDDINGS_INIT_ERROR,
                error
            )
        }

        try {
            ;[llm, modelInfo] = await this._initModel(
                service,
                llmPlatform,
                llmModelName
            )
        } catch (error) {
            if (error instanceof ChatLunaError) {
                throw error
            }
            throw new ChatLunaError(ChatLunaErrorCode.MODEL_INIT_ERROR, error)
        }

        try {
            await this._createChatHistory()
        } catch (error) {
            if (error instanceof ChatLunaError) {
                throw error
            }
            throw new ChatLunaError(
                ChatLunaErrorCode.CHAT_HISTORY_INIT_ERROR,
                error
            )
        }

        try {
            historyMemory = this._createHistoryMemory()
        } catch (error) {
            if (error instanceof ChatLunaError) {
                throw error
            }
            throw new ChatLunaError(ChatLunaErrorCode.UNKNOWN_ERROR, error)
        }

        this._chain = computed(() => {
            if (llm.value == null) {
                return undefined
            }
            return service.createChatChain(this._input.chatMode, {
                botName: this._input.botName,
                model: llm.value,
                embeddings: this._embeddings.value,
                historyMemory,
                preset: this._input.preset,
                vectorStoreName: this._input.vectorStoreName,
                supportChatChain:
                    modelInfo?.value != null &&
                    this._supportChatMode(modelInfo.value)
            })
        })
    }

    get chatHistory(): BaseChatMessageHistory {
        return this._chatHistory
    }

    get chatMode(): string {
        return this._input.chatMode
    }

    get embeddings(): ComputedRef<Embeddings> {
        return this._embeddings
    }

    get preset(): ComputedRef<PresetTemplate> {
        return this._input.preset
    }

    async delete(ctx: Context, room: ConversationRoom): Promise<void> {
        await this.clearChatHistory()

        this._chain = undefined

        await ctx.database.remove('chathub_conversation', {
            id: room.conversationId
        })

        await ctx.database.remove('chathub_room', {
            roomId: room.roomId
        })
        await ctx.database.remove('chathub_room_member', {
            roomId: room.roomId
        })
        await ctx.database.remove('chathub_room_group_member', {
            roomId: room.roomId
        })

        await ctx.database.remove('chathub_user', {
            defaultRoomId: room.roomId
        })

        await ctx.database.remove('chathub_message', {
            conversation: room.conversationId
        })
    }

    async clearChatHistory(): Promise<void> {
        if (this._chatHistory == null) {
            await this._createChatHistory()
        }

        await this.ctx.root.parallel(
            'chatluna/clear-chat-history',
            this._input.conversationId,
            this
        )

        await this._chatHistory.clear()

        await this._chain?.value?.model.clearContext(this._input.conversationId)
    }

    async compressContext(force = false): Promise<CompressContextResult> {
        const wrapper = await this.getChatLunaLLMChainWrapper()
        const manager = this._ensureInfiniteContextManager()
        if (!manager) {
            throw new ChatLunaError(
                ChatLunaErrorCode.CHAT_HISTORY_INIT_ERROR,
                new Error('Chat history is not initialized')
            )
        }

        return manager.compressIfNeeded(wrapper, force)
    }

    private async _initEmbeddings(service: PlatformService) {
        const [platform, modelName] = parseRawModelName(this._input.embeddings)

        if (
            this._input.embeddings == null ||
            this._input.embeddings.length < 1 ||
            this._input.embeddings === '无'
        ) {
            return computed(() => emptyEmbeddings)
        }

        const clientRef = await service.getClient(platform)

        return computed(() => {
            const client = clientRef.value

            logger.info(`Init embeddings for %c`, this._input.embeddings)

            if (client == null || client instanceof PlatformModelClient) {
                logger.warn(
                    `Platform ${platform} is not supported, falling back to fake embeddings`
                )
                return emptyEmbeddings
            }

            if (client instanceof PlatformEmbeddingsClient) {
                return client.createModel(modelName)
            } else if (client instanceof PlatformModelAndEmbeddingsClient) {
                const model = client.createModel(modelName)

                if (model instanceof ChatLunaChatModel) {
                    logger.warn(
                        `Model ${modelName} is not an embeddings model, falling back to fake embeddings`
                    )
                    return emptyEmbeddings
                }

                return model
            }
        })
    }

    private async _initModel(
        service: PlatformService,
        llmPlatform: string,
        llmModelName: string
    ): Promise<
        [ComputedRef<ChatLunaChatModel>, ComputedRef<ModelInfo | undefined>]
    > {
        const llmInfo = service.findModel(llmPlatform, llmModelName)

        const llmModel = await this.ctx.chatluna.createChatModel(
            llmPlatform,
            llmModelName
        )

        if (llmModel.value instanceof ChatLunaChatModel) {
            return [llmModel, llmInfo]
        }

        throw new ChatLunaError(
            ChatLunaErrorCode.MODEL_INIT_ERROR,
            new Error(`Model ${llmModelName} is not a chat model`)
        )
    }

    private _supportChatMode(modelInfo: ModelInfo) {
        if (
            !modelInfo.capabilities.includes(ModelCapabilities.ToolCall) &&
            this._input.chatMode === 'plugin'
        ) {
            return false
        }

        return true
    }

    private async _createChatHistory(): Promise<BaseChatMessageHistory> {
        if (this._chatHistory != null) {
            return this._chatHistory
        }

        this._chatHistory = new KoishiChatMessageHistory(
            this.ctx,
            this._input.conversationId,
            10000
        )

        await this._chatHistory.loadConversation()

        return this._chatHistory
    }

    private _createHistoryMemory() {
        if (this._historyMemory) {
            return this._historyMemory
        }

        this._historyMemory = new BufferMemory({
            returnMessages: true,
            inputKey: 'input',
            outputKey: 'output',
            chatHistory: this._chatHistory,
            humanPrefix: 'user',
            aiPrefix: this._input.botName
        })

        return this._historyMemory
    }

    private _ensureInfiniteContextManager():
        | InfiniteContextManager
        | undefined {
        if (!this._chatHistory) {
            return undefined
        }

        if (!this._infiniteContextManager) {
            this._infiniteContextManager = new InfiniteContextManager({
                chatHistory: this._chatHistory,
                conversationId: this._input.conversationId,
                preset: this._input.preset,
                threshold:
                    this.ctx.chatluna.currentConfig.infiniteContextThreshold
            })
        }

        return this._infiniteContextManager
    }
}

export interface ChatInterfaceInput {
    chatMode: string
    botName?: string
    preset?: ComputedRef<PresetTemplate>
    model: string
    embeddings?: string
    vectorStoreName?: string
    conversationId: string
}

declare module 'koishi' {
    interface Events {
        'chatluna/before-chat': (
            conversationId: string,
            message: HumanMessage,
            promptVariables: ChainValues,
            chatInterface: ChatInterface,
            session: Session
        ) => Promise<void>
        'chatluna/after-chat': (
            conversationId: string,
            sourceMessage: HumanMessage,
            responseMessage: AIMessage,
            promptVariables: ChainValues,
            chatInterface: ChatInterface,
            session: Session
        ) => Promise<void>
        'chatluna/clear-chat-history': (
            conversationId: string,
            chatInterface: ChatInterface
        ) => Promise<void>
        'chatluna/after-chat-error': (
            error: Error,
            conversationId: string,
            sourceMessage: HumanMessage,
            promptVariables: ChainValues,
            chatInterface: ChatInterface,
            chain?: ChatLunaLLMChainWrapper,
            requestId?: string
        ) => Promise<void>
    }
}
