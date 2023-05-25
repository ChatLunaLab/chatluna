import { BaseChatMessageHistory, ChainValues, HumanChatMessage } from 'langchain/schema';
import { ChatHubChain, SystemPrompts } from '../chain/base';
import { VectorStore, VectorStoreRetriever } from 'langchain/vectorstores/base';
import { BaseChatModel } from 'langchain/chat_models/base';
import { Factory } from './factory';
import { ChatHubChatChain } from '../chain/chat_chain';
import { BufferMemory, ConversationSummaryMemory, VectorStoreRetrieverMemory } from 'langchain/memory';
import { CreateParams } from '../model/base';
import { ChatHubBrowsingChain } from '../chain/broswing_chat_chain';
import { ChatHubPluginChain } from '../chain/plugin_chat_chain';
import { Embeddings } from 'langchain/embeddings/base';
import { FakeEmbeddings } from 'langchain/embeddings/fake';
import { inMemoryVectorStoreRetrieverProvider } from '../model/in_memory';

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
            let embeddings: Embeddings

            if (this._input.createParams.longMemory !== true && this._input.chatMode !== "chat") {
                embeddings = new FakeEmbeddings()
            } else {
                embeddings = this._input.mixedEmbeddingsName ?
                    await Factory.createEmbeddings(this._input.mixedEmbeddingsName, this._input.createParams) : await Factory
                        .getDefaultEmbeddings(this._input.createParams)
            }

            this._input.createParams.embeddings = embeddings


            let vectorStoreRetriever: VectorStoreRetriever<VectorStore>

            if (this._input.createParams.longMemory !== true && this._input.chatMode !== "chat") {
                vectorStoreRetriever = await inMemoryVectorStoreRetrieverProvider.createVectorStoreRetriever({})
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

            this._model = await Factory.createModel(this._input.mixedModelName, this._input.createParams)

            this._historyMemory = this._input.historyMode === "all" ?
                new BufferMemory({
                    returnMessages: true,
                    chatHistory: this._input.chatHistory,
                    humanPrefix: "user",
                    aiPrefix: this._input.botName,
                }) : new ConversationSummaryMemory({
                    llm: this._model,
                    returnMessages: this._input.chatMode === "plugin",
                    chatHistory: this._input.chatHistory,
                })


            if (this._historyMemory instanceof ConversationSummaryMemory) {
                const memory = this._historyMemory as ConversationSummaryMemory
                memory.buffer = await memory.predictNewSummary((await memory.chatHistory.getMessages()).slice(-2), '')
            }

            this._chain = await this.createChain()

        } catch (error) {
            console.log(`Error in ChatInterface.init: ${error}`)
            return false
        }
        return true
    }

    async clearChatHistory(): Promise<void> {
        await this._input.chatHistory.getMessages()
        await this._input.chatHistory.clear()
        if (this._historyMemory instanceof ConversationSummaryMemory) {
            this._historyMemory.buffer = ""
        }
    }

    async createChain(): Promise<ChatHubChain> {
        if (this._input.chatMode === "chat") {
            return ChatHubChatChain.fromLLM(
                this._model,
                {
                    botName: this._input.botName,
                    longMemory: this._vectorStoreRetrieverMemory,
                    historyMemory: this._historyMemory,
                    systemPrompts: this._input.systemPrompts,
                }
            )
        } else if (this._input.chatMode === "browsing") {
            return ChatHubBrowsingChain.fromLLMAndTools(
                this._model,
                await Promise.all(Factory.selectToolProviders((name) => name.includes("search") || name.includes("web-browser")).map(async (tool) => {
                    return await tool.createTool({
                        model: this._model,
                        embeddings: this._vectorStoreRetrieverMemory.vectorStoreRetriever.vectorStore.embeddings,
                    })
                })),
                {
                    systemPrompts: this._input.systemPrompts,
                    botName: this._input.botName,
                    embeddings: this._vectorStoreRetrieverMemory.vectorStoreRetriever.vectorStore.embeddings,
                    historyMemory: this._historyMemory,
                }
            )
        } else if (this._input.chatMode === "plugin") {
            return ChatHubPluginChain.fromLLMAndTools(
                this._model,
                await Promise.all(Factory.selectToolProviders(_ => true).map(async (tool) => {
                    return await tool.createTool({
                        model: this._model,
                        embeddings: this._vectorStoreRetrieverMemory.vectorStoreRetriever.vectorStore.embeddings,
                    })
                })),
                {
                    systemPrompts: this._input.systemPrompts,
                    historyMemory: this._historyMemory,
                })
        }
        throw new Error(`Unsupported chat mode: ${this._input.chatMode}`)
    }
}

export interface ChatInterfaceInput {
    chatMode: "browsing" | "chat" | "plugin";
    historyMode: "all" | "summary";
    botName?: string;
    humanMessagePrompt?: string
    chatHistory: BaseChatMessageHistory;
    systemPrompts?: SystemPrompts
    // api key, cookie, etc. Used to visit the chat model
    // and embeddings ...
    createParams: CreateParams;
    mixedModelName: string;
    mixedEmbeddingsName?: string;
    mixedVectorStoreName?: string;
}