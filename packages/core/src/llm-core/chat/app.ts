import { BaseChatMessageHistory, ChainValues, HumanMessage } from 'langchain/schema';
import { ChatHubChain, SystemPrompts } from '../chain/base';
import { VectorStore, VectorStoreRetriever } from 'langchain/vectorstores/base';
import { BaseChatModel } from 'langchain/chat_models/base';
import { Factory } from './factory';
import { ChatHubChatChain } from '../chain/chat_chain';
import { BufferMemory, ConversationSummaryMemory, VectorStoreRetrieverMemory } from 'langchain/memory';
import { ChatHubBaseChatModel, CreateParams } from '../model/base';
import { ChatHubBrowsingChain } from '../chain/broswing_chat_chain';
import { ChatHubPluginChain } from '../chain/plugin_chat_chain';
import { Embeddings } from 'langchain/embeddings/base';
import { FakeEmbeddings } from 'langchain/embeddings/fake';
import { EmptyEmbeddings, inMemoryVectorStoreRetrieverProvider } from '../model/in_memory';
import { Tool } from 'langchain/tools';
import { ChatHubFunctionCallBrowsingChain } from '../chain/function_calling_browsing_chain';
import { createLogger } from '../utils/logger';
import { Context } from 'koishi';
import { ConversationRoom } from '../../types';


const logger = createLogger("@dingyi222666/chathub/llm-core/chat/app")

export class ChatInterface {

    private _input: ChatInterfaceInput
    private _vectorStoreRetrieverMemory: VectorStoreRetrieverMemory
    private _model: ChatHubBaseChatModel
    private _historyMemory: ConversationSummaryMemory | BufferMemory
    private _chain: ChatHubChain

    constructor(input: ChatInterfaceInput) {
        this._input = input
    }

    get chatHistory(): BaseChatMessageHistory { return this._input.chatHistory }

    async chat(message: HumanMessage): Promise<ChainValues> {
        return await this._chain.call(
            message)
    }

    async init(): Promise<boolean> {
        try {
            let embeddings: Embeddings

            logger.debug(`Chat mode: ${this._input.chatMode}, longMemory: ${this._input.createParams.longMemory}`)
            if (this._input.createParams.longMemory !== true && this._input.chatMode === "chat") {
                embeddings = new EmptyEmbeddings()
            } else {
                embeddings = this._input.mixedEmbeddingsName ?
                    await Factory.createEmbeddings(this._input.mixedEmbeddingsName, this._input.createParams) : await Factory
                        .getDefaultEmbeddings(this._input.createParams)
            }

            this._input.createParams.embeddings = embeddings

            let vectorStoreRetriever: VectorStoreRetriever<VectorStore>

            if (this._input.createParams.longMemory !== true || (this._input.chatMode !== "chat" && this._input.chatMode !== "browsing")) {
                if (embeddings instanceof EmptyEmbeddings) {
                    logger.warn("Embeddings are empty, setting topK to 0")
                    this._input.createParams.topK = 0
                }
                vectorStoreRetriever = await inMemoryVectorStoreRetrieverProvider.createVectorStoreRetriever(this._input.createParams)
            } else {
                vectorStoreRetriever = this._input.mixedVectorStoreName ? await Factory.createVectorStoreRetriever(this._input.mixedVectorStoreName, this._input.createParams) :
                    await Factory.getDefaltVectorStoreRetriever(this._input.createParams)
            }

            this._vectorStoreRetrieverMemory = new VectorStoreRetrieverMemory({
                returnDocs: true,
                inputKey: "user",
                outputKey: "your",
                vectorStoreRetriever: vectorStoreRetriever
            })

            this._input.createParams.vectorStoreRetriever = vectorStoreRetriever
            this._input.createParams.systemPrompts = this._input.systemPrompts

            const { model, provider } = await Factory.createModelAndProvider(this._input.mixedModelName, this._input.createParams)

            this._model = model

            if (await provider.isSupportedChatMode(model._modelType(), this._input.chatMode) === false) {
                logger.warn(`Chat mode ${this._input.chatMode} is not supported by model ${this._input.mixedModelName}, falling back to chat mode`)

                this._input.chatMode = "chat"
                embeddings = new EmptyEmbeddings()
                this._input.createParams.embeddings = embeddings
                this._input.createParams.topK = 0

                vectorStoreRetriever = await inMemoryVectorStoreRetrieverProvider.createVectorStoreRetriever(this._input.createParams)


                this._vectorStoreRetrieverMemory = new VectorStoreRetrieverMemory({
                    returnDocs: true,
                    inputKey: "user",
                    outputKey: "your",
                    vectorStoreRetriever: vectorStoreRetriever
                })

                this._input.createParams.vectorStoreRetriever = vectorStoreRetriever
            }

            await this._input.chatHistory.getMessages()

            this._historyMemory = this._input.historyMode === "all" ?
                new BufferMemory({
                    returnMessages: true,
                    inputKey: "input",
                    outputKey: "output",
                    chatHistory: this._input.chatHistory,
                    humanPrefix: "user",
                    aiPrefix: this._input.botName,
                }) : new ConversationSummaryMemory({
                    llm: this._model,
                    inputKey: "input",
                    humanPrefix: "user",
                    aiPrefix: this._input.botName,
                    outputKey: "output",
                    returnMessages: this._input.chatMode !== "chat",
                    chatHistory: this._input.chatHistory,
                })


            if (this._historyMemory instanceof ConversationSummaryMemory) {
                const memory = this._historyMemory as ConversationSummaryMemory
                memory.buffer = await memory.predictNewSummary((await memory.chatHistory.getMessages()).slice(-2), '')
            }

            this._chain = await this.createChain()

        } catch (error) {
            logger.error(`Error in ChatInterface.init: `)
            logger.error(error)
            if (error.stack) {
                logger.error(error.stack)
            }
            return false
        }
        return true
    }

    async clearChatHistory(): Promise<void> {
        await this._input.chatHistory.clear()
        await this._model.clearContext()
        if (this._historyMemory instanceof ConversationSummaryMemory) {
            this._historyMemory.buffer = ""
        }
    }

    async delete(ctx: Context, room: ConversationRoom): Promise<void> {
        await this._input.chatHistory.getMessages()
        await this._input.chatHistory.clear()
        await this._model.clearContext()

        await ctx.database.remove("chathub_conversaion", { id: room.conversationId })
        
        await ctx.database.remove('chathub_room', {
            roomId: room.roomId
        })
        await ctx.database.remove('chathub_room_member', {
            roomId: room.roomId
        })
        await ctx.database.remove('chathub_room_group_meber', {
            roomId: room.roomId
        })
    }


    async createChain(): Promise<ChatHubChain> {

        const createParams = {
            model: this._model,
            systemPrompts: this._input.systemPrompts,
            botName: this._input.botName,
            longMemory: this._vectorStoreRetrieverMemory,
            embeddings: this._vectorStoreRetrieverMemory.vectorStoreRetriever.vectorStore.embeddings,
            historyMemory: this._historyMemory,
        }

        return Factory.createChatChain(this._input.chatMode, createParams)
    }
}

export interface ChatInterfaceInput {
    chatMode: "browsing" | "chat" | "plugin";
    historyMode: "all" | "summary";
    botName?: string;
    humanMessagePrompt?: string
    chatHistory: BaseChatMessageHistory;

    systemPrompts?: SystemPrompts
    createParams: CreateParams;
    mixedModelName: string;
    mixedEmbeddingsName?: string;
    mixedVectorStoreName?: string;
}