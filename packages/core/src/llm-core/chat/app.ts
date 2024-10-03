import { BaseChatMessageHistory } from '@langchain/core/chat_history'
import { Embeddings } from '@langchain/core/embeddings'
import { ChainValues } from '@langchain/core/utils/types'
import { Context } from 'koishi'
import { parseRawModelName } from 'koishi-plugin-chatluna/llm-core/utils/count_tokens'
import {
    BufferMemory,
    ConversationSummaryMemory,
    VectorStoreRetrieverMemory
} from 'langchain/memory'
import { logger } from 'koishi-plugin-chatluna'
import { ConversationRoom } from '../../types'
import {
    ChatLunaError,
    ChatLunaErrorCode
} from 'koishi-plugin-chatluna/utils/error'
import { ChatHubLLMCallArg, ChatHubLLMChainWrapper } from '../chain/base'
import { KoishiChatMessageHistory } from '../memory/message/database_history'
import {
    emptyEmbeddings,
    inMemoryVectorStoreRetrieverProvider
} from 'koishi-plugin-chatluna/llm-core/model/in_memory'
import {
    PlatformEmbeddingsClient,
    PlatformModelAndEmbeddingsClient,
    PlatformModelClient
} from 'koishi-plugin-chatluna/llm-core/platform/client'
import {
    ClientConfig,
    ClientConfigWrapper
} from 'koishi-plugin-chatluna/llm-core/platform/config'
import {
    ChatHubBaseEmbeddings,
    ChatLunaChatModel
} from 'koishi-plugin-chatluna/llm-core/platform/model'
import { PlatformService } from 'koishi-plugin-chatluna/llm-core/platform/service'
import { ModelInfo } from 'koishi-plugin-chatluna/llm-core/platform/types'
import { HumanMessage } from '@langchain/core/messages'
import { PresetTemplate } from 'koishi-plugin-chatluna/llm-core/prompt'

export class ChatInterface {
    private _input: ChatInterfaceInput
    private _vectorStoreRetrieverMemory: VectorStoreRetrieverMemory
    private _chatHistory: KoishiChatMessageHistory
    private _chains: Record<string, ChatHubLLMChainWrapper> = {}

    private _errorCountsMap: Record<string, number[]> = {}
    private _chatCount = 0

    constructor(
        public ctx: Context,
        input: ChatInterfaceInput
    ) {
        this._input = input
    }

    async chat(arg: ChatHubLLMCallArg): Promise<ChainValues> {
        const [wrapper, config] = await this.createChatHubLLMChainWrapper()
        const configMD5 = config.md5()

        try {
            const response = await wrapper.call(arg)

            this._chatCount++

            return response
        } catch (e) {
            if (
                e instanceof ChatLunaError &&
                e.errorCode === ChatLunaErrorCode.API_UNSAFE_CONTENT
            ) {
                // unsafe content not to real error
                throw e
            }

            this._errorCountsMap[configMD5] =
                this._errorCountsMap[configMD5] ?? []

            let errorCountsArray = this._errorCountsMap[configMD5]

            errorCountsArray.push(Date.now())

            if (errorCountsArray.length > 100) {
                errorCountsArray = errorCountsArray.splice(
                    -config.value.maxRetries * 3
                )
            }

            this._errorCountsMap[configMD5] = errorCountsArray

            if (
                errorCountsArray.length > config.value.maxRetries &&
                // 20 mins
                checkRange(
                    errorCountsArray.splice(-config.value.maxRetries),
                    1000 * 60 * 20
                )
            ) {
                delete this._chains[configMD5]
                delete this._errorCountsMap[configMD5]

                const service = this.ctx.chatluna.platform

                await service.makeConfigStatus(config.value, false)
            }

            if (e instanceof ChatLunaError) {
                throw e
            } else {
                throw new ChatLunaError(ChatLunaErrorCode.UNKNOWN_ERROR, e)
            }
        }
    }

    async createChatHubLLMChainWrapper(): Promise<
        [ChatHubLLMChainWrapper, ClientConfigWrapper]
    > {
        const service = this.ctx.chatluna.platform
        const [llmPlatform, llmModelName] = parseRawModelName(this._input.model)
        const currentLLMConfig = await service.randomConfig(llmPlatform)

        if (this._chains[currentLLMConfig.md5()]) {
            return [this._chains[currentLLMConfig.md5()], currentLLMConfig]
        }

        let embeddings: Embeddings

        let llm: ChatLunaChatModel
        let modelInfo: ModelInfo
        let historyMemory: ConversationSummaryMemory | BufferMemory

        try {
            embeddings = await this._initEmbeddings(service)
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
                currentLLMConfig.value,
                llmModelName
            )
        } catch (error) {
            if (error instanceof ChatLunaError) {
                throw error
            }
            throw new ChatLunaError(ChatLunaErrorCode.MODEL_INIT_ERROR, error)
        }

        embeddings = (await this._checkChatMode(modelInfo)) ?? embeddings

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
            historyMemory = await this._createHistoryMemory(llm)
        } catch (error) {
            if (error instanceof ChatLunaError) {
                throw error
            }
            throw new ChatLunaError(ChatLunaErrorCode.UNKNOWN_ERROR, error)
        }

        const chatChain = await service.createChatChain(this._input.chatMode, {
            botName: this._input.botName,
            model: llm,
            embeddings,
            historyMemory,
            preset: this._input.preset,
            vectorStoreName: this._input.vectorStoreName
        })

        this._chains[currentLLMConfig.md5()] = chatChain
        return [chatChain, currentLLMConfig]
    }

    get chatHistory(): BaseChatMessageHistory {
        return this._chatHistory
    }

    get vectorStoreRetrieverMemory(): VectorStoreRetrieverMemory {
        return this._vectorStoreRetrieverMemory
    }

    async delete(ctx: Context, room: ConversationRoom): Promise<void> {
        await this.clearChatHistory()

        for (const chain of Object.values(this._chains)) {
            await chain.model.clearContext()
        }

        if (this._vectorStoreRetrieverMemory) {
            const vectorStore =
                this._vectorStoreRetrieverMemory?.vectorStoreRetriever
                    ?.vectorStore

            await vectorStore?.delete()
        }

        this._chains = {}

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
    }

    async clearChatHistory(): Promise<void> {
        if (this._chatHistory == null) {
            await this._createChatHistory()
        }

        await this._chatHistory.clear()

        for (const chain of Object.values(this._chains)) {
            await chain.model.clearContext()
            const historyMemory = chain.historyMemory
            if (historyMemory instanceof ConversationSummaryMemory) {
                historyMemory.buffer = ''
            }
        }
    }

    private async _initEmbeddings(
        service: PlatformService
    ): Promise<ChatHubBaseEmbeddings> {
        if (this._input.chatMode === 'chat') {
            return emptyEmbeddings
        }

        if (this._input.embeddings == null) {
            logger.warn(
                'Embeddings are empty, falling back to fake embeddings. Try check your config.'
            )
            return emptyEmbeddings
        }

        const [platform, modelName] = parseRawModelName(this._input.embeddings)

        logger.info(`init embeddings for %c`, this._input.embeddings)

        const client = await service.randomClient(platform)

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
    }

    private async _initModel(
        service: PlatformService,
        config: ClientConfig,
        llmModelName: string
    ): Promise<[ChatLunaChatModel, ModelInfo]> {
        const platform = await service.getClient(config)

        const llmInfo = (await platform.getModels()).find(
            (model) => model.name === llmModelName
        )

        const llmModel = platform.createModel(llmModelName)

        if (llmModel instanceof ChatLunaChatModel) {
            return [llmModel, llmInfo]
        }
    }

    private async _checkChatMode(modelInfo: ModelInfo) {
        if (
            // default check
            (!modelInfo.supportMode?.includes(this._input.chatMode) &&
                // all
                !modelInfo.supportMode?.includes('all')) ||
            // func call with plugin browsing
            (!modelInfo.functionCall && this._input.chatMode === 'plugin')
        ) {
            logger.warn(
                `Chat mode ${this._input.chatMode} is not supported by model ${this._input.model}, falling back to chat mode`
            )

            this._input.chatMode = 'chat'
            const embeddings = emptyEmbeddings

            const vectorStoreRetriever =
                await inMemoryVectorStoreRetrieverProvider.createVectorStoreRetriever(
                    {
                        embeddings
                    }
                )

            this._vectorStoreRetrieverMemory = new VectorStoreRetrieverMemory({
                returnDocs: true,
                inputKey: 'user',
                outputKey: 'your',
                vectorStoreRetriever
            })

            return embeddings
        }

        return undefined
    }

    private async _createChatHistory(): Promise<BaseChatMessageHistory> {
        if (this._chatHistory != null) {
            return this._chatHistory
        }

        this._chatHistory = new KoishiChatMessageHistory(
            this.ctx,
            this._input.conversationId,
            this._input.maxMessagesCount
        )

        await this._chatHistory.loadConversation()

        return this._chatHistory
    }

    private async _createHistoryMemory(
        model: ChatLunaChatModel
    ): Promise<ConversationSummaryMemory | BufferMemory> {
        const historyMemory =
            this._input.historyMode === 'all'
                ? new BufferMemory({
                      returnMessages: true,
                      inputKey: 'input',
                      outputKey: 'output',
                      chatHistory: this._chatHistory,
                      humanPrefix: 'user',
                      aiPrefix: this._input.botName
                  })
                : new ConversationSummaryMemory({
                      llm: model,
                      inputKey: 'input',
                      humanPrefix: 'user',
                      aiPrefix: this._input.botName,
                      outputKey: 'output',
                      returnMessages: this._input.chatMode !== 'chat',
                      chatHistory: this._chatHistory
                  })

        if (historyMemory instanceof ConversationSummaryMemory) {
            const memory = historyMemory as ConversationSummaryMemory
            memory.buffer = await memory.predictNewSummary(
                (await memory.chatHistory.getMessages()).slice(-2),
                ''
            )
        }

        return historyMemory
    }
}

export interface ChatInterfaceInput {
    chatMode: string
    historyMode: 'all' | 'summary'
    botName?: string
    preset?: () => Promise<PresetTemplate>
    model: string
    embeddings?: string
    vectorStoreName?: string
    conversationId: string
    maxMessagesCount: number
}

function checkRange(times: number[], delayTime: number) {
    const first = times[0]
    const last = times[times.length - 1]

    return last - first < delayTime
}

declare module 'koishi' {
    interface Events {
        'chatluna/before-chat': (
            conversationId: string,
            message: HumanMessage,
            promptVariables: ChainValues,
            chatInterface: ChatInterface
        ) => Promise<void>
        'chatluna/after-chat': (
            conversationId: string,
            message: HumanMessage,
            promptVariables: ChainValues,
            chatInterface: ChatInterface
        ) => Promise<void>
        'chatluna/clear-chat-history': (
            conversationId: string,
            chatInterface: ChatInterface
        ) => Promise<void>
    }
}
