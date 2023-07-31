import EventEmitter from 'events';
import { EmbeddingsParams } from 'langchain/embeddings/base';
import { ChatChainProvider, CreateVectorStoreRetrieverParams, EmbeddingsProvider, ModelProvider, ToolProvider, VectorStoreRetrieverProvider } from '../model/base';
import { EmptyEmbeddings, inMemoryVectorStoreRetrieverProvider } from '../model/in_memory';
import { createLogger } from '../utils/logger';


const logger = createLogger('@dingyi222666/chathub/llm-core/chat/factory')

/**
 * A factory class for managing chat objects, such as models, embeddings, and vector stores.
 */
export class Factory {
    private static _modelProviders: Record<string, ModelProvider> = {}
    private static _embeddingProviders: Record<string, EmbeddingsProvider> = {}
    private static _vectorStoreRetrieverProviders: Record<string, VectorStoreRetrieverProvider> = {}
    private static _chatChainProviders: Record<string, ChatChainProvider> = {}
    private static _tools: Record<string, ToolProvider> = {}
    private static _recommendProviders: Record<string, string[]> = {}
    private static _eventEmitter = new EventEmitter()

    /**
     * Register a model provider.
     * @param provider The model provider to register.
     * @returns The registered model provider.
    */
    static registerModelProvider(provider: ModelProvider) {
        Factory._modelProviders[provider.name] = provider
        logger.debug(`Registering model provider ${provider.name}`)
        Factory.emit("model-provider-added", provider)
        return async () => {
            await provider.dispose()
            delete Factory._modelProviders[provider.name]
            logger.debug(`Unregistering model provider ${provider.name}`)
        }
    }

    /**
     * Register an embeddings provider.
     * @param provider The embeddings provider to register.
     * @returns The registered embeddings provider.
     **/
    static registerEmbeddingsProvider(provider: EmbeddingsProvider) {
        Factory._embeddingProviders[provider.name] = provider
        logger.debug(`Registering embeddings provider ${provider.name}`)
        Factory.emit("embeddings-provider-added", provider)
        return async () => {
            await provider.dispose()
            delete Factory._embeddingProviders[provider.name]
            logger.debug(`Unregistering embeddings provider ${provider.name}`)
        }
    }

    /** 
     * Register a vector store retriever provider.
     * @param provider The vector store retriever provider to register.
     * @returns The registered vector store retriever provider.
     * */
    static registerVectorStoreRetrieverProvider(provider: VectorStoreRetrieverProvider) {
        Factory._vectorStoreRetrieverProviders[provider.name] = provider
        logger.debug(`Registering vector store retriever provider ${provider.name}`)
        Factory.emit("vector-store-retriever-provider-added", provider)
        return async () => {
            await provider.dispose()
            delete Factory._vectorStoreRetrieverProviders[provider.name]
            logger.debug(`Unregistering vector store retriever provider ${provider.name}`)
        }
    }

    /**
     * Register a chat chain provider.
     * 
     * @param provider The chat chain provider to register.
     * @returns The registered chat chain provider.
     */
    static registerChatChainProvider(provider: ChatChainProvider) {
        Factory._chatChainProviders[provider.name] = provider
        Factory.emit("chat-chain-provider-added", provider)
        return async () => {
            delete Factory._chatChainProviders[provider.name]
        }
    }

    /**
     * Register a tool
     * @param tool The tool to register.
     * @returns The registered tool.
     */
    static registerToolProvider(name: string, tool: ToolProvider) {
        Factory._tools[name] = tool
        return async () => {
            delete Factory._tools[name]
        }
    }

    static addRecommandEmbeddings(list: string[]) {
        Factory._recommendProviders['embeddings'] = [...this.recommendEmbeddings, ...list]
    }

    static addRecommandVectorStoreRetrievers(list: string[]) {
        Factory._recommendProviders['vectorStoreRetrievers'] = [...this.recommendVectorStoreRetrievers, ...list]
    }

    static set recommendEmbeddings(list: string[]) {
        Factory._recommendProviders['embeddings'] = list
    }

    static set recommendVectorStoreRetrievers(list: string[]) {
        Factory._recommendProviders['vectorStoreRetrievers'] = list
    }

    static get recommendEmbeddings() {
        return Factory._recommendProviders['embeddings'] ?? ['openai', 'huggingface']
    }

    static get recommendVectorStoreRetrievers() {
        return Factory._recommendProviders['vectorStoreRetrievers'] ?? ['chroma', 'milvus', 'pinecone', 'faiss']
    }

    /**
     * 
     * @param modelName modelName, must use the format providerName/modelName
     * @param params 
     * @returns 
     */
    static async createModel(mixedModelName: string, params: Record<string, any>) {
        return (await Factory.createModelAndProvider(mixedModelName, params)).model
    }

    static async createModelAndProvider(mixedModelName: string, params: Record<string, any>) {
        const [providerName, modelName] = mixedModelName.split(/(?<=^[^\/]+)\//)

        for (const provider of Object.values(Factory._modelProviders)) {
            if (provider.name === providerName && (await provider.isSupported(modelName))) {
                return { provider, model: await provider.createModel(modelName, params) }
            }
        }
        throw new Error(`No provider found for model ${modelName}`)
    }

    static async createEmbeddings(mixedModelName: string, params: EmbeddingsParams) {
        const [providerName, modelName] = mixedModelName.split(/(?<=^[^\/]+)\//)
        logger.debug(`Creating embeddings ${modelName} with provider ${providerName}`)
        for (const provider of Object.values(Factory._embeddingProviders)) {
            if (provider.name === providerName && provider.isSupported(modelName)) {
                return provider.createEmbeddings(modelName, params)
            }
        }
        throw new Error(`No provider found for embeddings ${modelName}`)
    }

    static async getDefaultEmbeddings(params: Record<string, any> = {}) {
        const providers = Object.values(Factory._embeddingProviders)

        // local -> remote
        const recommendProviders = [...this.recommendEmbeddings]
        while (recommendProviders.length > 0) {
            const currentProvider = recommendProviders.shift()

            try {
                const availableProvider = Factory._embeddingProviders[currentProvider]

                if (!availableProvider) {
                    continue
                }

                return await availableProvider.createEmbeddings(params.embeddingsName ?? (await availableProvider.listEmbeddings())[0], params)
            } catch (error) {
                logger.debug(`Failed to create embeddings ${currentProvider}, try next one`)
            }
        }

        // try return the first one

        if (providers.length > 1 || !providers[0]) {
            logger.error(`Cannot select a embeddings, rolling back to the fake embeddings`)
            return new EmptyEmbeddings()
        }

        try {
            return providers[0].createEmbeddings(params.modelName, params)
        } catch (error) {
            logger.error(`Cannot select a embeddings, rolling back to the fake embeddings`)
            return new EmptyEmbeddings()
        }

    }

    static async getDefaltVectorStoreRetriever(params: CreateVectorStoreRetrieverParams = {}) {

        if (!params.embeddings) {
            params.embeddings = await Factory.getDefaultEmbeddings(params)
        }

        const providers = Object.values(Factory._vectorStoreRetrieverProviders)

        // local -> remote
        const recommendProviders = [...this.recommendVectorStoreRetrievers]
        while (recommendProviders.length > 0) {
            const currentProvider = recommendProviders.shift()
            try {
                const availableProvider = Factory._vectorStoreRetrieverProviders[currentProvider]

                if (!availableProvider) {
                    continue
                }

                return await availableProvider.createVectorStoreRetriever(params)
            } catch (error) {
                logger.warn(`Failed to create vector store retriever ${currentProvider}, try next one`)

                logger.error(error)
            }
        }

        // try return the first one

        if (providers.length > 1 || !providers[0]) {
            logger.warn(`Cannot select a vector store retriever, rolling back to the memory vector store retriever`)

            return inMemoryVectorStoreRetrieverProvider.createVectorStoreRetriever(params)
        }

        const firstProvider = providers[0]

        try {
            return firstProvider.createVectorStoreRetriever(params)
        } catch (error) {
            logger.warn(`Failed to create vector store retriever ${firstProvider.name}, rolling back to the memory vector store retriever`)
            logger.error(error)

            if (error.stack) {
                logger.error(error.stack)
            }

            return inMemoryVectorStoreRetrieverProvider.createVectorStoreRetriever(params)
        }
    }


    static async createVectorStoreRetriever(mixedModelName: string, params: CreateVectorStoreRetrieverParams) {

        if (!params.embeddings) {
            params.embeddings = await Factory.getDefaultEmbeddings(params)
        }

        const [providerName, modelName] = mixedModelName.split(/(?<=^[^\/]+)\//)
        for (const provider of Object.values(Factory._vectorStoreRetrieverProviders)) {
            if (provider.name === providerName) {
                return provider.createVectorStoreRetriever(params)
            }
        }
        throw new Error(`No provider found for vector store retriever ${modelName}`)
    }

    static async createChatChain(name: string, params: Record<string, any>) {
        const provider = Factory._chatChainProviders[name]
        if (!provider) {
            throw new Error(`No provider found for chat chain ${name}`)
        }
        return provider.create(params)
    }

    static selectToolProviders(filter: (name: string, tool?: ToolProvider) => boolean) {
        const results: ToolProvider[] = []
        for (const [name, tool] of Object.entries(Factory._tools)) {
            try {
                if (filter(name, tool)) {
                    results.push(tool)
                }
            } catch (error) {
                logger.error(`Failed to check if tool provider ${name} is supported`)
                logger.error(error)
                if (error.stack) {
                    logger.error(error.stack)
                }
            }
        }
        return results
    }

    static async selectModelProviders(filter: (name: string, provider?: ModelProvider) => Promise<boolean>) {
        const results: ModelProvider[] = []
        for (const [name, provider] of Object.entries(Factory._modelProviders)) {
            try {
                if (await filter(name, provider)) {
                    results.push(provider)
                }
            } catch (error) {
                logger.error(`Failed to check if model provider ${name} is supported`)
                logger.error(error)
                if (error.stack) {
                    logger.error(error.stack)
                }
            }
        }
        return results
    }

    static async selectEmbeddingProviders(filter: (name: string, provider?: EmbeddingsProvider) => Promise<boolean>) {
        const results: EmbeddingsProvider[] = []
        for (const [name, provider] of Object.entries(Factory._embeddingProviders)) {
            try {
                if (await filter(name, provider)) {
                    results.push(provider)
                }
            } catch (error) {
                logger.error(`Failed to check if ?? provider ${name} is supported`)
                logger.error(error)
                if (error.stack) {
                    logger.error(error.stack)
                }
            }
        }
        return results
    }

    static async selectChatChainProviders(filter: (name: string, provider?: ChatChainProvider) => Promise<boolean>) {
        const results: ChatChainProvider[] = []
        for (const [name, provider] of Object.entries(Factory._chatChainProviders)) {
            try {
                if (await filter(name, provider)) {
                    results.push(provider)
                }
            } catch (error) {
                logger.error(`Failed to check if ?? provider ${name} is supported`)
                logger.error(error)
                if (error.stack) {
                    logger.error(error.stack)
                }
            }
        }
        return results
    }

    static async selectVectorStoreRetrieverProviders(filter: (name: string, provider?: VectorStoreRetrieverProvider) => Promise<boolean>) {
        const results: VectorStoreRetrieverProvider[] = []
        for (const [name, provider] of Object.entries(Factory._vectorStoreRetrieverProviders)) {
            try {
                if (await filter(name, provider)) {
                    results.push(provider)
                }
            } catch (error) {
                logger.error(`Failed to check if ?? provider ${name} is supported`)
                logger.error(error)
                if (error.stack) {
                    logger.error(error.stack)
                }
            }
        }
        return results
    }


    static on<T extends keyof FactoryEvents>(eventName: T, func: FactoryEvents[T]) {
        Factory._eventEmitter.on(eventName, func)
    }

    static emit<T extends keyof FactoryEvents>(eventName: T, ...args: Parameters<FactoryEvents[T]>) {
        Factory._eventEmitter.emit(eventName, ...args)
    }
}

interface FactoryEvents {
    'chat-chain-provider-added': (provider: ChatChainProvider) => void
    'model-provider-added': (provider: ModelProvider) => void
    'embeddings-provider-added': (provider: EmbeddingsProvider) => void
    'vector-store-retriever-provider-added': (provider: VectorStoreRetrieverProvider) => void
}