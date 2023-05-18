import { BaseChatMessageHistory, ChainValues, HumanChatMessage } from 'langchain/schema';
import { ChatHubChain, SystemPrompts } from '../chain/base';
import { VectorStore, VectorStoreRetriever } from 'langchain/vectorstores/base';
import { BaseChatModel } from 'langchain/chat_models/base';
import { Factory } from './factory';
import { ChatHubChatChain } from '../chain/chat_chain';
import { BufferMemory, ConversationSummaryMemory, VectorStoreRetrieverMemory } from 'langchain/memory';
import { CreateParams } from '../model/base';

export class ChatInterface {

    private _input: ChatInterfaceInput
    private _vectorStoreRetrieverMemory: VectorStoreRetrieverMemory
    private _model: BaseChatModel
    private _historyMemory: ConversationSummaryMemory | BufferMemory
    private _chain: ChatHubChain

    constructor(input: ChatInterfaceInput) {
        this._input = input
    }

    get chatHistory(): BaseChatMessageHistory { return this._input.chatHistory }

    async chat(message: HumanChatMessage): Promise<ChainValues> {
        return await this._chain.call(
            message)
    }

    async init(): Promise<boolean> {
        try {

            const embeddings = this._input.mixedEmbeddingsName ?
                await Factory.createEmbeddings(this._input.mixedEmbeddingsName, this._input.createParams) : await Factory
                    .getDefaultEmbeddings(this._input.createParams)


            this._input.createParams.embeddings = embeddings

            const vectorStoreRetriever = this._input.mixedVectorStoreName ? await Factory.createVectorStoreRetriever(this._input.mixedVectorStoreName, this._input.createParams) :
                await Factory.getDefaltVectorStoreRetriever(this._input.createParams)

            this._vectorStoreRetrieverMemory = new VectorStoreRetrieverMemory({
                vectorStoreRetriever: vectorStoreRetriever
            })


            this._input.createParams.vectorStoreRetriever = vectorStoreRetriever
            this._input.createParams.systemPrompts = this._input.systemPrompts

            this._model = await Factory.createModel(this._input.mixedModelName, this._input.createParams)

            this._historyMemory = this._input.historyMode === "all" ?
                new BufferMemory({
                    returnMessages: true,
                    chatHistory: this._input.chatHistory,
                    humanPrefix: "user",
                    aiPrefix: this._input.botName,
                }) : new ConversationSummaryMemory({
                    llm: this._model,
                    returnMessages: false,
                    chatHistory: this._input.chatHistory,
                })

            this._chain = await this.createChain()

        } catch (error) {
            console.log(`Error in ChatInterface.init: ${error}`)
            return false
        }
        return true
    }

    async createChain(): Promise<ChatHubChain> {
        if (this._input.chatMode === "chat") {
            return ChatHubChatChain.fromLLM(
                this._model,
                {
                    botName: this._input.botName,
                    longMemory: this._vectorStoreRetrieverMemory,
                    historyMemory: this._historyMemory,
                    systemPrompts: this._input.systemPrompts
                }
            )
        }
        throw new Error(`Unsupported chat mode: ${this._input.chatMode}`)
    }
}


export interface ChatInterfaceInput {
    chatMode: "search-chat" | "chat" | "search" | "local-data";
    historyMode: "all" | "summary";
    botName?: string;
    chatHistory: BaseChatMessageHistory;
    systemPrompts?: SystemPrompts
    // api key, cookie, etc. Used to visit the chat model
    // and embeddings ...
    createParams: CreateParams;
    mixedModelName: string;
    mixedEmbeddingsName?: string;
    mixedVectorStoreName?: string;
}