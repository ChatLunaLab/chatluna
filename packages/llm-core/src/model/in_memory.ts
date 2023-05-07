import { VectorStoreRetriever, VectorStore } from 'langchain/dist/vectorstores/base';
import { CreateParams, CreateVectorStoreRetrieverParams, VectorStoreRetrieverProvider } from './base';
import { Embeddings } from 'langchain/dist/embeddings/base';
import { MemoryVectorStore } from 'langchain/dist/vectorstores/memory';

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
            InMemoryVectorStoreRetrieverProvider._vectorStoreRetriever = new VectorStoreRetriever({
                vectorStore: await MemoryVectorStore.fromExistingIndex(embeddings)
            })
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

export const inMemoryVectorStoreRetrieverProvider = new InMemoryVectorStoreRetrieverProvider()