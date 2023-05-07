import { BaseLLM } from 'langchain/dist/llms/base';
import { BaseChatModel } from 'langchain/dist/chat_models/base';
import { Embeddings } from 'langchain/dist/embeddings/base';
import { VectorStoreRetriever } from 'langchain/dist/vectorstores/base';
import { PrivateKeyInput } from 'crypto';
import { Factory } from '../chat/factory';

export abstract class BaseProvider {
    abstract name: string
    abstract description?: string

    private _disposed = false
    private _disposedCallbacks: (() => void)[] = []


    abstract isSupported(modelName: string): Promise<boolean>

    /**
     * Dispose of any resources held by this provider.
     */
    dispose(): void {
        if (!this._disposed) {
            this._disposed = true
            this._disposedCallbacks.forEach((callback) => callback())
            this._disposedCallbacks.length = 0
        }
    }


    onDispose(callback: () => void): void {
        if (this._disposed) {
            callback()
        } else {
            this._disposedCallbacks.push(callback)
        }
    }

    abstract register()
}

export abstract class ModelProvider extends BaseProvider {

    register() {
        Factory.registerModelProvider(this)
    }

    abstract createModel(modelName: string, params: CreateParams): Promise<BaseChatModel>

    abstract listModels(): Promise<string[]>
}

export abstract class EmbeddingsProvider extends BaseProvider {

    register() {
        Factory.registerEmbeddingsProvider(this)
    }

    abstract createEmbeddings(modelName: string, params: CreateParams): Promise<Embeddings>

    abstract listEmbeddings(): Promise<string[]>
}

export abstract class VectorStoreRetrieverProvider extends BaseProvider {

    register() {
        Factory.registerVectorStoreRetrieverProvider(this)
    }

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