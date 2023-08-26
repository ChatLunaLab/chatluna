import { BaseChatMessageHistory, ChainValues, HumanMessage } from 'langchain/schema';
import { ChatHubLLMChainWrapper, SystemPrompts } from '../chain/base';
import { VectorStore, VectorStoreRetriever } from 'langchain/vectorstores/base';
import { BufferMemory, ConversationSummaryMemory, VectorStoreRetrieverMemory } from 'langchain/memory';
import { Embeddings } from 'langchain/embeddings/base';
import { emptyEmbeddings, inMemoryVectorStoreRetrieverProvider } from '../model/in_memory';
import { createLogger } from '../utils/logger';
import { Context } from 'koishi';
import { ConversationRoom } from '../../types';
import { ClientConfig, ClientConfigWrapper } from '../platform/config';
import { ChatEvents } from '../../services/types';
import { getPlatformService } from '../..';
import { PlatformService } from '../platform/service';
import { parseRawModelName } from '../utils/count_tokens';
import { PlatformEmbeddingsClient, PlatformModelAndEmbeddingsClient, PlatformModelClient } from '../platform/client';
import { ChatHubBaseEmbeddings, ChatHubChatModel } from '../platform/model';
import { ChatHubError, ChatHubErrorCode } from '../../utils/error';
import { ModelInfo } from '../platform/types';
import { KoishiDataBaseChatMessageHistory } from '../memory/message/database_memory';


const logger = createLogger("@dingyi222666/chathub/llm-core/chat/app")

export class ChatInterface {

    private _input: ChatInterfaceInput
    private _vectorStoreRetrieverMemory: VectorStoreRetrieverMemory
    private _chatHistory: KoishiDataBaseChatMessageHistory;
    private _chains: Record<string, ChatHubLLMChainWrapper> = {}
    private _errorCount: Record<string, number> = {}


    constructor(public ctx: Context, input: ChatInterfaceInput) {
        this._input = input
    }

    async chat(message: HumanMessage, event: ChatEvents): Promise<ChainValues> {
        const [wrapper, config] = await this.createChatHubLLMChainWrapper()
        const configMD5 = config.md5()

        try {
            return wrapper.call(message, event)
        } catch (e) {

            this._errorCount[configMD5] = this._errorCount[config.md5()] ?? 0

            this._errorCount[configMD5] += 1

            if (this._errorCount[configMD5] > config.value.maxRetries) {
                delete this._chains[configMD5]
                delete this._errorCount[configMD5]

                const service = getPlatformService()

                await service.makeConfigStatus(config.value, false)
            }

            if (e instanceof ChatHubError) {
                throw e
            } else {
                throw new ChatHubError(ChatHubErrorCode.UNKNOWN_ERROR, e)
            }
        }
    }

    async createChatHubLLMChainWrapper(): Promise<[ChatHubLLMChainWrapper, ClientConfigWrapper]> {

        let service = getPlatformService()
        const [llmPlatform, llmModelName] = parseRawModelName(this._input.model)
        const currentLLMConfig = await service.randomConfig(llmPlatform)

        if (this._chains[currentLLMConfig.md5()]) {
            return [this._chains[currentLLMConfig.md5()], currentLLMConfig]
        }

        let embeddings: Embeddings
        let vectorStoreRetrieverMemory: VectorStoreRetrieverMemory
        let llm: ChatHubChatModel
        let modelInfo: ModelInfo
        let historyMemory: ConversationSummaryMemory | BufferMemory


        try {
            embeddings = await this._initEmbeddings(service)
        } catch (error) {
            throw new ChatHubError(ChatHubErrorCode.EMBEDDINGS_INIT_ERROR, error)
        }

        try {
            vectorStoreRetrieverMemory = await this._initVectorStoreMemory(service, embeddings)
        } catch (error) {
            throw new ChatHubError(ChatHubErrorCode.VECTOR_STORE_INIT_ERROR, error)
        }


        try {
            [llm, modelInfo] = await this._initModel(service, currentLLMConfig.value, llmModelName)
        } catch (error) {
            throw new ChatHubError(ChatHubErrorCode.MODEL_INIT_ERROR, error)
        }


        embeddings = (await this._checkChatMode(modelInfo)) ?? embeddings


        try {
            await this._createChatHistory()
        } catch (error) {
            throw new ChatHubError(ChatHubErrorCode.CHAT_HISTORY_INIT_ERROR, error)
        }

        try {
            historyMemory = await this._createHistoryMemory(llm)
        } catch (error) {
            throw new ChatHubError(ChatHubErrorCode.UNKNOWN_ERROR, error)
        }


        const chatChain = await service.createChatChain(this._input.chatMode, {
            botName: this._input.botName,
            model: llm,
            embeddings: embeddings,
            longMemory: vectorStoreRetrieverMemory,
            historyMemory: historyMemory,
            systemPrompt: this._input.systemPrompts,
            vectorStoreName: this._input.vectorStoreName
        })

        this._chains[currentLLMConfig.md5()] = chatChain

        return [chatChain, currentLLMConfig]
    }


    get chatHistory(): BaseChatMessageHistory { return this._chatHistory }

    async delete(ctx: Context, room: ConversationRoom): Promise<void> {
        await this._chatHistory.getMessages()
        await this._chatHistory.clear()

        for (const chain of Object.values(this._chains)) {
            await chain.model.clearContext()
        }

        this._chains = {}

        await ctx.database.remove("chathub_conversation", { id: room.conversationId })

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
        await this._chatHistory.clear()


        for (const chain of Object.values(this._chains)) {
            await chain.model.clearContext()
            const historyMemory = chain.historyMemory
            if (historyMemory instanceof ConversationSummaryMemory) {
                historyMemory.buffer = ""
            }
        }
    }


    private async _initEmbeddings(service: PlatformService): Promise<ChatHubBaseEmbeddings> {
        logger.debug(`Chat mode: ${this._input.chatMode}, longMemory: ${this._input.longMemory}`)

        if (this._input.longMemory !== true && this._input.chatMode === "chat") {
            return emptyEmbeddings
        }

        if (this._input.embeddings == null) {
            logger.warn("Embeddings are empty, falling back to fake embeddings. Try check your config.")
            return emptyEmbeddings
        }

        const [platform, modelName] = parseRawModelName(this._input.embeddings)

        const client = await service.randomClient(platform)

        if (client == null || client instanceof PlatformModelClient) {
            logger.warn(`Platform ${platform} is not supported, falling back to fake embeddings`)
            return emptyEmbeddings
        }

        if (client instanceof PlatformEmbeddingsClient) {
            return client.createModel(modelName)
        } else if (client instanceof PlatformModelAndEmbeddingsClient) {
            const model = client.createModel(modelName)

            if (model instanceof ChatHubChatModel) {
                logger.warn(`Model ${modelName} is not an embeddings model, falling back to fake embeddings`)
                return emptyEmbeddings
            }

            return model
        }
    }

    private async _initVectorStoreMemory(service: PlatformService, embeddings: ChatHubBaseEmbeddings): Promise<VectorStoreRetrieverMemory> {

        if (this._vectorStoreRetrieverMemory != null) {
            return this._vectorStoreRetrieverMemory
        }

        let vectorStoreRetriever: VectorStoreRetriever<VectorStore>

        if (this._input.longMemory !== true || (this._input.chatMode !== "chat" && this._input.chatMode !== "browsing")) {

            vectorStoreRetriever = await inMemoryVectorStoreRetrieverProvider.createVectorStoreRetriever({
                topK: 0,
                embeddings: embeddings
            })

        } else if (this._input.vectorStoreName == null) {
            logger.warn("Vector store is empty, falling back to fake vector store. Try check your config.")

            vectorStoreRetriever = await inMemoryVectorStoreRetrieverProvider.createVectorStoreRetriever({
                topK: 0,
                embeddings: embeddings
            })
        } else {
            vectorStoreRetriever = await service.createVectorStoreRetriever(this._input.vectorStoreName, {
                embeddings: embeddings,
            })
        }

        this._vectorStoreRetrieverMemory = new VectorStoreRetrieverMemory({
            returnDocs: true,
            inputKey: "user",
            outputKey: "your",
            vectorStoreRetriever: vectorStoreRetriever
        })

        return this._vectorStoreRetrieverMemory
    }


    private async _initModel(service: PlatformService, config: ClientConfig, llmModelName: string): Promise<[ChatHubChatModel, ModelInfo]> {
        const platform = await service.getClient(config)

        const llmInfo = (await platform.getModels()).find((model) => model.name === llmModelName)

        const llmModel = platform.createModel(llmModelName)

        return [llmModel, llmInfo]
    }

    private async _checkChatMode(modelInfo: ModelInfo) {
        if (modelInfo.supportChatMode(this._input.chatMode) === false) {
            logger.warn(`Chat mode ${this._input.chatMode} is not supported by model ${this._input.model}, falling back to chat mode`)

            this._input.chatMode = "chat"
            const embeddings = emptyEmbeddings

            const vectorStoreRetriever = await inMemoryVectorStoreRetrieverProvider.createVectorStoreRetriever({
                topK: 0,
                embeddings: embeddings
            })


            this._vectorStoreRetrieverMemory = new VectorStoreRetrieverMemory({
                returnDocs: true,
                inputKey: "user",
                outputKey: "your",
                vectorStoreRetriever: vectorStoreRetriever
            })

            return embeddings
        }

        return null
    }

    private async _createChatHistory(): Promise<BaseChatMessageHistory> {
        if (this._chatHistory != null) {
            return this._chatHistory
        }

        this._chatHistory = new KoishiDataBaseChatMessageHistory(this.ctx, this._input.conversationId)

        await this._chatHistory.getMessages()

        return this._chatHistory
    }

    private async _createHistoryMemory(model: ChatHubChatModel): Promise<ConversationSummaryMemory | BufferMemory> {
        const historyMemory = this._input.historyMode === "all" ?
            new BufferMemory({
                returnMessages: true,
                inputKey: "input",
                outputKey: "output",
                chatHistory: this._chatHistory,
                humanPrefix: "user",
                aiPrefix: this._input.botName,
            }) : new ConversationSummaryMemory({
                llm: model,
                inputKey: "input",
                humanPrefix: "user",
                aiPrefix: this._input.botName,
                outputKey: "output",
                returnMessages: this._input.chatMode !== "chat",
                chatHistory: this._chatHistory,
            })


        if (historyMemory instanceof ConversationSummaryMemory) {
            const memory = historyMemory as ConversationSummaryMemory
            memory.buffer = await memory.predictNewSummary((await memory.chatHistory.getMessages()).slice(-2), '')
        }

        return historyMemory
    }


}

export interface ChatInterfaceInput {
    chatMode: string
    historyMode: "all" | "summary";
    botName?: string;
    systemPrompts?: SystemPrompts
    model: string;
    embeddings?: string;
    vectorStoreName?: string;
    longMemory: Boolean,
    conversationId: string
}