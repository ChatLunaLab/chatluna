import { BaseChatMessageHistory } from '@langchain/core/chat_history'
import { Embeddings } from '@langchain/core/embeddings'
import { ChainValues } from '@langchain/core/utils/types'
import { VectorStore, VectorStoreRetriever } from '@langchain/core/vectorstores'
import { Context, Random } from 'koishi'
import { parseRawModelName } from 'koishi-plugin-chatluna/llm-core/utils/count_tokens'
import {
    BufferMemory,
    ConversationSummaryMemory,
    VectorStoreRetrieverMemory
} from 'langchain/memory'
import { Config, logger } from 'koishi-plugin-chatluna'
import { ConversationRoom } from '../../types'
import {
    ChatLunaError,
    ChatLunaErrorCode
} from 'koishi-plugin-chatluna/utils/error'
import {
    ChatHubLLMCallArg,
    ChatHubLLMChainWrapper,
    SystemPrompts
} from '../chain/base'
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
import { ChatHubLongMemoryChain } from '../chain/long_memory_chain'
import { ScoreThresholdRetriever } from 'langchain/retrievers/score_threshold'

export class ChatInterface {
    private _input: ChatInterfaceInput
    private _vectorStoreRetrieverMemory: VectorStoreRetrieverMemory
    private _chatHistory: KoishiChatMessageHistory
    private _chains: Record<string, WrapperWithLongMemory> = {}

    private _errorCount: Record<string, number> = {}
    private _chatCount = 0
    private _random = new Random()

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
            const response = await wrapper.instance.call(arg)

            this._chatCount++

            if (
                this._chatCount > this._random.int(2, 4) &&
                this._input.longMemory
            ) {
                await this._saveLongMemory(wrapper.longMemoryChain)
                this._chatCount = 0
            }

            return response
        } catch (e) {
            this._errorCount[configMD5] = this._errorCount[config.md5()] ?? 0

            this._errorCount[configMD5] += 1

            if (this._errorCount[configMD5] > config.value.maxRetries) {
                delete this._chains[configMD5]
                delete this._errorCount[configMD5]

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
        [WrapperWithLongMemory, ClientConfigWrapper]
    > {
        const service = this.ctx.chatluna.platform
        const [llmPlatform, llmModelName] = parseRawModelName(this._input.model)
        const currentLLMConfig = await service.randomConfig(llmPlatform)

        if (this._chains[currentLLMConfig.md5()]) {
            return [this._chains[currentLLMConfig.md5()], currentLLMConfig]
        }

        let embeddings: Embeddings
        let vectorStoreRetrieverMemory: VectorStoreRetrieverMemory
        let llm: ChatLunaChatModel
        let modelInfo: ModelInfo
        let historyMemory: ConversationSummaryMemory | BufferMemory
        let longMemoryChain: ChatHubLongMemoryChain

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
            vectorStoreRetrieverMemory = await this._initVectorStoreMemory(
                service,
                embeddings
            )
        } catch (error) {
            if (error instanceof ChatLunaError) {
                throw error
            }
            throw new ChatLunaError(
                ChatLunaErrorCode.VECTOR_STORE_INIT_ERROR,
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

        if (this._input.longMemory) {
            try {
                longMemoryChain = await this._createLongMemory(
                    llm,
                    vectorStoreRetrieverMemory,
                    historyMemory
                )
            } catch (error) {
                if (error instanceof ChatLunaError) {
                    throw error
                }
                throw new ChatLunaError(
                    ChatLunaErrorCode.LONG_MEMORY_INIT_ERROR,
                    error
                )
            }
        }

        const chatChain = await service.createChatChain(this._input.chatMode, {
            botName: this._input.botName,
            model: llm,
            embeddings,
            longMemory: vectorStoreRetrieverMemory,
            historyMemory,
            systemPrompt: this._input.systemPrompts,
            vectorStoreName: this._input.vectorStoreName
        })

        const wrapper = {
            instance: chatChain,
            longMemoryChain
        }

        this._chains[currentLLMConfig.md5()] = wrapper
        return [wrapper, currentLLMConfig]
    }

    get chatHistory(): BaseChatMessageHistory {
        return this._chatHistory
    }

    async delete(ctx: Context, room: ConversationRoom): Promise<void> {
        await this._chatHistory.getMessages()
        await this._chatHistory.clear()

        for (const chain of Object.values(this._chains)) {
            await chain.instance.model.clearContext()
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
            await chain.instance.model.clearContext()
            const historyMemory = chain.instance.historyMemory
            if (historyMemory instanceof ConversationSummaryMemory) {
                historyMemory.buffer = ''
            }
        }
    }

    private async _initEmbeddings(
        service: PlatformService
    ): Promise<ChatHubBaseEmbeddings> {
        if (
            this._input.longMemory !== true &&
            this._input.chatMode === 'chat'
        ) {
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

    private async _initVectorStoreMemory(
        service: PlatformService,
        embeddings: ChatHubBaseEmbeddings
    ): Promise<VectorStoreRetrieverMemory> {
        if (this._vectorStoreRetrieverMemory != null) {
            return this._vectorStoreRetrieverMemory
        }

        let vectorStoreRetriever:
            | ScoreThresholdRetriever<VectorStore>
            | VectorStoreRetriever<VectorStore>

        if (
            this._input.longMemory !== true ||
            (this._input.chatMode !== 'chat' &&
                this._input.chatMode !== 'browsing')
        ) {
            vectorStoreRetriever =
                await inMemoryVectorStoreRetrieverProvider.createVectorStoreRetriever(
                    {
                        embeddings
                    }
                )
        } else if (this._input.vectorStoreName == null) {
            logger.warn(
                'Vector store is empty, falling back to fake vector store. Try check your config.'
            )

            vectorStoreRetriever =
                await inMemoryVectorStoreRetrieverProvider.createVectorStoreRetriever(
                    {
                        embeddings
                    }
                )
        } else {
            const store = await service.createVectorStore(
                this._input.vectorStoreName,
                {
                    embeddings,
                    key: this._input.conversationId
                }
            )

            /* store.asRetriever({
                k: 20,
                searchType: 'similarity'
            }) */

            const retriever = ScoreThresholdRetriever.fromVectorStore(store, {
                minSimilarityScore: this._input.longMemorySimilarity, // Finds results with at least this similarity score
                maxK: 30, // The maximum K value to use. Use it based to your chunk size to make sure you don't run out of tokens
                kIncrement: 2, // How much to increase K by each time. It'll fetch N results, then N + kIncrement, then N + kIncrement * 2, etc.,
                searchType: 'mmr'
            })

            vectorStoreRetriever = retriever
        }

        this._vectorStoreRetrieverMemory = new VectorStoreRetrieverMemory({
            returnDocs: true,
            inputKey: 'user',
            outputKey: 'your',
            vectorStoreRetriever
        })

        return this._vectorStoreRetrieverMemory
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
            !modelInfo.supportMode?.includes(this._input.chatMode) &&
            // all
            !modelInfo.supportMode?.includes('all') &&
            // func call with plugin browsing
            !modelInfo.functionCall &&
            ['plugin', 'browsing'].includes(this._input.chatMode)
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

    private _createLongMemory(
        llm: ChatLunaChatModel,
        vectorStoreRetrieverMemory: VectorStoreRetrieverMemory,
        historyMemory: ConversationSummaryMemory | BufferMemory
    ): ChatHubLongMemoryChain {
        return ChatHubLongMemoryChain.fromLLM(llm, {
            historyMemory,
            longMemory: vectorStoreRetrieverMemory,
            systemPrompts: this._input.systemPrompts
        })
    }

    private async _saveLongMemory(chain: ChatHubLongMemoryChain) {
        await chain?.call({
            events: {},
            stream: false,
            message: undefined,
            conversationId: undefined,
            session: undefined
        })
    }
}

type WrapperWithLongMemory = {
    instance: ChatHubLLMChainWrapper
    longMemoryChain?: ChatHubLongMemoryChain
}

export interface ChatInterfaceInput {
    chatMode: string
    historyMode: 'all' | 'summary'
    botName?: string
    systemPrompts?: SystemPrompts
    model: string
    embeddings?: string
    vectorStoreName?: string
    longMemory: boolean
    conversationId: string
    maxMessagesCount: number
    longMemorySimilarity?: number
}
