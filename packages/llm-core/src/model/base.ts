import { BaseLLM } from 'langchain/dist/llms/base';
import { BaseChatModel } from 'langchain/dist/chat_models/base';
import { Embeddings } from 'langchain/dist/embeddings/base';
import { VectorStoreRetriever } from 'langchain/dist/vectorstores/base';
import { PromiseLikeDisposeable } from '../utils/types';

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

    abstract createModel(modelName: string, params: CreateParams): Promise<BaseChatModel>

    abstract listModels(): Promise<string[]>
}

export abstract class EmbeddingsProvider extends BaseProvider {


    abstract createEmbeddings(modelName: string, params: CreateParams): Promise<Embeddings>

    abstract listEmbeddings(): Promise<string[]>
}

export abstract class VectorStoreRetrieverProvider extends BaseProvider {

    abstract createVectorStoreRetriever(params: CreateVectorStoreRetrieverParams): Promise<VectorStoreRetriever>
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