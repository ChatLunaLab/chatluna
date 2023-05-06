import { EmbeddingsParams } from 'langchain/dist/embeddings/base';
import { EmbeddingsProvider, ModelProvider, VectorStoreRetrieverProvider } from '../model/base';
import { VectorStore } from 'langchain/dist/vectorstores/base';

/**
 * A factory class for managing chat objects, such as models, embeddings, and vector stores.
 */
export class Factory {

    private static _modelProviders: Record<string, ModelProvider> = {}
    private static _embeddingProviders: Record<string, EmbeddingsProvider> = {}
    private static _vectorStoreRetrieverProviders: Record<string, VectorStoreRetrieverProvider> = {}

    /**
     * Register a model provider.
     * @param provider The model provider to register.
     * @returns The registered model provider.
    */
    static registerModelProvider(provider: ModelProvider) {
        Factory._modelProviders[provider.name] = provider
        return provider
    }

    /**
     * Register an embeddings provider.
     * @param provider The embeddings provider to register.
     * @returns The registered embeddings provider.
     **/
    static registerEmbeddingsProvider(provider: EmbeddingsProvider) {
        Factory._embeddingProviders[provider.name] = provider
        return provider
    }

    /** 
     * Register a vector store retriever provider.
     * @param provider The vector store retriever provider to register.
     * @returns The registered vector store retriever provider.
     * */
    static registerVectorStoreRetrieverProvider(provider: VectorStoreRetrieverProvider) {
        Factory._vectorStoreRetrieverProviders[provider.name] = provider
        return provider
    }

    /**
     * 
     * @param modelName modelName, must use the format providerName-modelName
     * @param params 
     * @returns 
     */
    static async createModel(mixedModelName: string, params: Record<string, any>) {
        const [providerName, modelName] = mixedModelName.split('-')
        for (const provider of Object.values(Factory._modelProviders)) {
            if (provider.name === providerName && provider.isSupported(modelName)) {
                return provider.createModel(modelName, params)
            }
        }
        throw new Error(`No provider found for model ${modelName}`)
    }

    static async createEmbeddings(mixedModelName: string, params: EmbeddingsParams) {
        const [providerName, modelName] = mixedModelName.split('-')
        for (const provider of Object.values(Factory._embeddingProviders)) {
            if (provider.name === providerName && provider.isSupported(modelName)) {
                return provider.createEmbeddings(modelName, params)
            }
        }
        throw new Error(`No provider found for embeddings ${modelName}`)
    }

    static async createVectorStoreRetriever(mixedModelName: string, params: Record<string, any>) {
        const [providerName, modelName] = mixedModelName.split('-')
        for (const provider of Object.values(Factory._vectorStoreRetrieverProviders)) {
            if (provider.name === providerName) {
                return provider.createVectorStoreRetriever(params)
            }
        }
        throw new Error(`No provider found for vector store retriever ${modelName}`)
    }

}