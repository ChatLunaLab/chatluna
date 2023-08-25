import { VectorStoreRetriever, VectorStore } from 'langchain/vectorstores/base';
import { Embeddings, EmbeddingsParams } from 'langchain/embeddings/base';
import { MemoryVectorStore } from 'langchain/vectorstores/memory';
import { createLogger } from '../utils/logger';
import { CreateVectorStoreRetrieverParams } from '../platform/types';
import { ChatHubBaseEmbeddings } from '../platform/model';

const logger = createLogger('@dingyi222666/chathub/llm-core/model/in_memory')

class InMemoryVectorStoreRetrieverProvider {
  
  
    async createVectorStoreRetriever(params: CreateVectorStoreRetrieverParams): Promise<VectorStoreRetriever<VectorStore>> {
        const embeddings = params.embeddings

        const result = (await MemoryVectorStore.fromExistingIndex(embeddings)
        ).asRetriever(params.topK ?? 3)

        logger.debug(`Created in memory vector store retriever with ${params.topK ?? 3} topK, current topK is ${result.k}`)
        return result

    }

}


export class EmptyEmbeddings extends ChatHubBaseEmbeddings {
    constructor(params?: EmbeddingsParams) {
        super(params ?? {});
    }

    embedDocuments(documents: string[]): Promise<number[][]> {
        return Promise.resolve(documents.map(() => []));
    }

    embedQuery(_: string): Promise<number[]> {
        return Promise.resolve([]);
    }
}

export const emptyEmbeddings = new EmptyEmbeddings()

export const inMemoryVectorStoreRetrieverProvider = new InMemoryVectorStoreRetrieverProvider()

