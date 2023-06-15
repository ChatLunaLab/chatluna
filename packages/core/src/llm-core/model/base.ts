import { BaseLLM } from 'langchain/llms/base';
import { BaseChatModel } from 'langchain/chat_models/base';
import { Embeddings } from 'langchain/embeddings/base';
import { SaveableVectorStore, VectorStore, VectorStoreRetriever } from 'langchain/vectorstores/base';
import { PromiseLikeDisposeable } from '../utils/types';
import { Tool } from 'langchain/tools';
import { encodingForModel } from '../utils/tiktoken';
import { getModelNameForTiktoken } from '../utils/count_tokens';
import { Tiktoken } from 'js-tiktoken/lite';
import { Document } from 'langchain/document';
import { createLogger } from '../utils/logger';

const logger = createLogger("@dingyi222666/chathub/llm-core/model/base");

export abstract class BaseProvider {
    abstract name: string
    abstract description?: string

    private _disposed = false
    private _disposedCallbacks: PromiseLikeDisposeable[] = []


    abstract isSupported(modelName: string): Promise<boolean>

    /**
     * Dispose of any resources held by this provider.
     */
    async dispose() {
        if (!this._disposed) {
            this._disposed = true
            for (const callback of this._disposedCallbacks) {
                await callback()
            }
            this._disposedCallbacks.length = 0
        }
    }


    onDispose(callback: PromiseLikeDisposeable): void {
        if (this._disposed) {
            callback()
        } else {
            this._disposedCallbacks.push(callback)
        }
    }

    getExtraInfo(): Record<string, any> {
        return {}
    }

}

export abstract class ModelProvider extends BaseProvider {

    abstract createModel(modelName: string, params: CreateParams): Promise<ChatHubBaseChatModel>

    abstract listModels(): Promise<string[]>

    async recommendModel() {
        return (await this.listModels())[0]
    }

    async isSupportedChatMode(modelName: string, chatMode: "browsing" | "plugin" | "chat"): Promise<boolean> {
        const models = await this.listModels()

        if (!models.includes(modelName)) {
            return false
        }

        return chatMode === "chat"
    }
}

export abstract class EmbeddingsProvider extends BaseProvider {


    abstract createEmbeddings(modelName: string, params: CreateParams): Promise<Embeddings>

    abstract listEmbeddings(): Promise<string[]>
}

export abstract class VectorStoreRetrieverProvider extends BaseProvider {

    abstract createVectorStoreRetriever(params: CreateVectorStoreRetrieverParams): Promise<VectorStoreRetriever>

    isSupported(modelName: string): Promise<boolean> {
        throw new Error('Method not supported.');
    }
}

export abstract class ChatHubBaseChatModel extends BaseChatModel {

    protected __encoding: Tiktoken

    async getNumTokens(text: string) {
        // fallback to approximate calculation if tiktoken is not available
        let numTokens = Math.ceil(text.length / 4);

        if (!this.__encoding) {
            try {
                this.__encoding = await encodingForModel(
                    "modelName" in this
                        ? getModelNameForTiktoken(this.modelName as string)
                        : "gpt2"
                );
            } catch (error) {
                logger.warn(
                    "Failed to calculate number of tokens, falling back to approximate count",
                    error
                );
            }
        }

        const start = Date.now();
        if (this.__encoding) {
            numTokens = this.__encoding.encode(text).length;
        }
        return numTokens;
    }

    async clearContext(): Promise<void> {
        return
    }

}

export class ChatHubSaveableVectorStore extends VectorStore {

    constructor(
        private _store: SaveableVectorStore,
        private _saveableFunction: (store: SaveableVectorStore) => Promise<void>,
    ) {
        super(_store.embeddings, {})
    }

    addVectors(vectors: number[][], documents: Document[]) {
        return this._store.addVectors(vectors, documents)
    }
    addDocuments(documents: Document[]) {
        return this._store.addDocuments(documents)
    }
    similaritySearchVectorWithScore(query: number[], k: number, filter?: this["FilterType"]) {
        return this._store.similaritySearchVectorWithScore(query, k, filter)
    }

    save() {
        return this._saveableFunction(this._store)
    }
}

export interface ToolProvider {
    name: string
    description?: string
    createTool(params: Record<string, any>): Promise<Tool>
}

export type CreateParams = Record<string, any>

export type CreateVectorStoreRetrieverParams = {
    embeddings?: Embeddings
} & CreateParams

export type CreateEmbeddingsParams = {
    model?: string
} & CreateParams

export type CreateModelParams = {
    apiKey?: string
} & CreateParams