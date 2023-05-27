import { VectorStoreRetriever, VectorStore } from 'langchain/vectorstores/base';
import { CreateParams, CreateVectorStoreRetrieverParams, VectorStoreRetrieverProvider } from './base';
import { Embeddings, EmbeddingsParams } from 'langchain/embeddings/base';
import { MemoryVectorStore } from 'langchain/vectorstores/memory';
import { Document } from 'langchain/document';

class InMemoryVectorStoreRetrieverProvider extends VectorStoreRetrieverProvider {
    private static _vectorStoreRetriever: VectorStoreRetriever

    name = "in_memory";
    description = "In memory vector store retriever provider";

    async createVectorStoreRetriever(params: CreateVectorStoreRetrieverParams): Promise<VectorStoreRetriever<VectorStore>> {
        const embeddings = params.embeddings

        if (!embeddings) {
            throw new Error("No embeddings provided")
        }

        if (!InMemoryVectorStoreRetrieverProvider._vectorStoreRetriever) {
            InMemoryVectorStoreRetrieverProvider._vectorStoreRetriever = (await MemoryVectorStore.fromExistingIndex(embeddings)
            ).asRetriever(10)
        }

        return InMemoryVectorStoreRetrieverProvider._vectorStoreRetriever
    }


    refresh() {
        InMemoryVectorStoreRetrieverProvider._vectorStoreRetriever = null
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

