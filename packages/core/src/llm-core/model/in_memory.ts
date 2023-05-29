import { VectorStoreRetriever, VectorStore } from 'langchain/vectorstores/base';
import { CreateParams, CreateVectorStoreRetrieverParams, VectorStoreRetrieverProvider } from './base';
import { Embeddings, EmbeddingsParams } from 'langchain/embeddings/base';
import { MemoryVectorStore } from 'langchain/vectorstores/memory';
import { Document } from 'langchain/document';

class InMemoryVectorStoreRetrieverProvider extends VectorStoreRetrieverProvider {
  
    name = "in_memory";
    description = "In memory vector store retriever provider";

    async createVectorStoreRetriever(params: CreateVectorStoreRetrieverParams): Promise<VectorStoreRetriever<VectorStore>> {
        const embeddings = params.embeddings

        if (!embeddings) {
            throw new Error("No embeddings provided")
        }

        return (await MemoryVectorStore.fromExistingIndex(embeddings)
        ).asRetriever(3)

    }

    isSupported(modelName: string): Promise<boolean> {
        throw new Error('Method not supported.');
    }


}


export class EmptyEmbeddings extends Embeddings {
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

export const inMemoryVectorStoreRetrieverProvider = new InMemoryVectorStoreRetrieverProvider()

