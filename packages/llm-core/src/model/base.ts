import { BaseLLM } from 'langchain/llms/base';
import { BaseChatModel } from 'langchain/chat_models/base';
import { Embeddings } from 'langchain/embeddings/base';
import { VectorStoreRetriever } from 'langchain/vectorstores/base';
import { PromiseLikeDisposeable } from '../utils/types';
import { StructuredTool, Tool } from 'langchain/tools';

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

    async recommendModel() {
        return (await this.listModels())[0]
    }
}

export abstract class EmbeddingsProvider extends BaseProvider {


    abstract createEmbeddings(modelName: string, params: CreateParams): Promise<Embeddings>

    abstract listEmbeddings(): Promise<string[]>
}

export abstract class VectorStoreRetrieverProvider extends BaseProvider {

    abstract createVectorStoreRetriever(params: CreateVectorStoreRetrieverParams): Promise<VectorStoreRetriever>
}

export interface ToolProvider {
    name: string
    description?: string
    createTool(params: Record<string, any>): Promise<StructuredTool | Tool>
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