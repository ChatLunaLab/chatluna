import { EmbeddingsParams } from '@langchain/core/embeddings'
import { VectorStore, VectorStoreRetriever } from '@langchain/core/vectorstores'
import { ChatLunaBaseEmbeddings } from 'koishi-plugin-chatluna/llm-core/platform/model'
import { CreateVectorStoreParams } from 'koishi-plugin-chatluna/llm-core/platform/types'
declare class InMemoryVectorStoreRetrieverProvider {
    createVectorStoreRetriever(
        params: CreateVectorStoreParams
    ): Promise<VectorStoreRetriever<VectorStore>>
}
export declare class EmptyEmbeddings extends ChatLunaBaseEmbeddings {
    constructor(params?: EmbeddingsParams)
    embedDocuments(documents: string[]): Promise<number[][]>
    embedQuery(_: string): Promise<number[]>
}
export declare const emptyEmbeddings: EmptyEmbeddings
export declare const inMemoryVectorStoreRetrieverProvider: InMemoryVectorStoreRetrieverProvider
export {}
