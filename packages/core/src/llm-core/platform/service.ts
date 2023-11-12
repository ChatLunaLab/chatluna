import {
    BasePlatformClient,
    PlatformEmbeddingsClient,
    PlatformModelAndEmbeddingsClient,
    PlatformModelClient
} from './client'
import {
    ChatHubChainInfo,
    ChatHubTool,
    CreateChatHubLLMChainParams,
    CreateVectorStoreFunction,
    CreateVectorStoreParams,
    ModelInfo,
    ModelType,
    PlatformClientNames
} from './types'
import { ClientConfig, ClientConfigPool } from './config'
import { Context, sleep } from 'koishi'
import { ChatHubLLMChainWrapper } from '../chain/base'

export class PlatformService {
    private static _platformClients: Record<string, BasePlatformClient> = {}
    private static _createClientFunctions: Record<
        string,
        (ctx: Context, config: ClientConfig) => BasePlatformClient
    > = {}

    private static _configPools: Record<string, ClientConfigPool> = {}
    private static _tools: Record<string, ChatHubTool> = {}
    private static _models: Record<string, ModelInfo[]> = {}
    private static _chatChains: Record<string, ChatHubChainInfo> = {}
    private static _vectorStore: Record<string, CreateVectorStoreFunction> = {}

    constructor(private ctx: Context) {}

    registerClient(
        name: PlatformClientNames,
        createClientFunction: (
            ctx: Context,
            config: ClientConfig
        ) => BasePlatformClient
    ) {
        if (PlatformService._createClientFunctions[name]) {
            throw new Error(`Client ${name} already exists`)
        }
        PlatformService._createClientFunctions[name] = createClientFunction
        return async () => await this.unregisterClient(name)
    }

    registerConfigPool(name: string, configPool: ClientConfigPool) {
        if (PlatformService._configPools[name]) {
            throw new Error(`Config pool ${name} already exists`)
        }
        PlatformService._configPools[name] = configPool
    }

    async registerTool(name: string, toolCreator: ChatHubTool) {
        PlatformService._tools[name] = toolCreator
        await this.ctx.parallel('chatluna/tool-updated', this)
        return () => this.unregisterTool(name)
    }

    async unregisterTool(name: string) {
        delete PlatformService._tools[name]
        await this.ctx.parallel('chatluna/tool-updated', this)
    }

    async unregisterClient(platform: PlatformClientNames) {
        const configPool = PlatformService._configPools[platform]

        if (!configPool) {
            throw new Error(`Config pool ${platform} not found`)
        }

        const configs = configPool.getConfigs()

        await sleep(100)

        delete PlatformService._models[platform]

        for (const config of configs) {
            const client = await this.getClient(config.value)

            if (client == null) {
                continue
            }

            delete PlatformService._platformClients[
                this._getClientConfigAsKey(config.value)
            ]

            if (client instanceof PlatformModelClient) {
                await this.ctx.parallel(
                    'chatluna/model-removed',
                    this,
                    platform,
                    client
                )
            } else if (client instanceof PlatformEmbeddingsClient) {
                await this.ctx.parallel(
                    'chatluna/embeddings-removed',
                    this,
                    platform,
                    client
                )
            } else if (client instanceof PlatformModelAndEmbeddingsClient) {
                await this.ctx.parallel(
                    'chatluna/embeddings-removed',
                    this,
                    platform,
                    client
                )
                await this.ctx.parallel(
                    'chatluna/model-removed',
                    this,
                    platform,
                    client
                )
            }
        }

        delete PlatformService._configPools[platform]
        delete PlatformService._createClientFunctions[platform]
    }

    async unregisterVectorStore(name: string) {
        delete PlatformService._vectorStore[name]
        await sleep(50)
        await this.ctx.parallel('chatluna/vector-store-removed', this, name)
    }

    async registerVectorStore(
        name: string,
        vectorStoreRetrieverCreator: CreateVectorStoreFunction
    ) {
        await sleep(50)
        PlatformService._vectorStore[name] = vectorStoreRetrieverCreator
        await this.ctx.parallel('chatluna/vector-store-added', this, name)
        return async () => await this.unregisterVectorStore(name)
    }

    async registerChatChain(
        name: string,
        description: string,
        createChatChainFunction: (
            params: CreateChatHubLLMChainParams
        ) => Promise<ChatHubLLMChainWrapper>
    ) {
        await sleep(50)
        PlatformService._chatChains[name] = {
            name,
            description,
            createFunction: createChatChainFunction
        }
        await this.ctx.parallel(
            'chatluna/chat-chain-added',
            this,
            PlatformService._chatChains[name]
        )
        return async () => await this.unregisterChatChain(name)
    }

    async unregisterChatChain(name: string) {
        const chain = PlatformService._chatChains[name]
        delete PlatformService._chatChains[name]
        sleep(50)
        await this.ctx.parallel('chatluna/chat-chain-removed', this, chain)
    }

    getModels(platform: PlatformClientNames, type: ModelType) {
        return (
            PlatformService._models[platform]?.filter(
                (m) => type === ModelType.all || m.type === type
            ) ?? []
        )
    }

    getTools() {
        return Object.keys(PlatformService._tools)
    }

    getConfigs(platform: string) {
        return PlatformService._configPools[platform]?.getConfigs() ?? []
    }

    resolveModel(platform: PlatformClientNames, name: string) {
        return PlatformService._models[platform]?.find((m) => m.name === name)
    }

    getAllModels(type: ModelType) {
        const allModel: string[] = []

        for (const platform in PlatformService._models) {
            const models = PlatformService._models[platform]

            for (const model of models) {
                if (type === ModelType.all || model.type === type) {
                    allModel.push(platform + '/' + model.name)
                }
            }
        }

        return allModel
    }

    getVectorStoreRetrievers() {
        return Object.keys(PlatformService._vectorStore)
    }

    getChatChains() {
        return Object.values(PlatformService._chatChains)
    }

    makeConfigStatus(config: ClientConfig, isAvailable: boolean) {
        const platform = config.platform
        const pool = PlatformService._configPools[platform]

        if (!pool) {
            throw new Error(`Config pool ${platform} not found`)
        }

        return pool.markConfigStatus(config, isAvailable)
    }

    async createVectorStore(name: string, params: CreateVectorStoreParams) {
        const vectorStoreRetriever = PlatformService._vectorStore[name]

        if (!vectorStoreRetriever) {
            throw new Error(`Vector store retriever ${name} not found`)
        }

        return await vectorStoreRetriever(params)
    }

    async randomConfig(platform: string, lockConfig: boolean = false) {
        return PlatformService._configPools[platform]?.getConfig(lockConfig)
    }

    async randomClient(platform: string, lockConfig: boolean = false) {
        const config = await this.randomConfig(platform, lockConfig)

        if (!config) {
            return null
        }

        const client = await this.getClient(config.value)

        return client
    }

    async getClient(config: ClientConfig) {
        return (
            PlatformService._platformClients[
                this._getClientConfigAsKey(config)
            ] ?? (await this.createClient(config.platform, config))
        )
    }

    async refreshClient(
        client: BasePlatformClient,
        platform: string,
        config: ClientConfig
    ) {
        const isAvailable = await client.isAvailable()

        const pool = PlatformService._configPools[platform]

        await pool.markConfigStatus(config, isAvailable)

        if (!isAvailable) {
            return null
        }

        const models = await client.getModels()

        if (models == null) {
            await pool.markConfigStatus(config, false)

            return null
        }

        const availableModels = PlatformService._models[platform] ?? []

        await sleep(200)
        // filter existing models
        PlatformService._models[platform] = availableModels.concat(
            models.filter(
                (m) => !availableModels.some((am) => am.name === m.name)
            )
        )

        if (client instanceof PlatformModelClient) {
            await this.ctx.parallel(
                'chatluna/model-added',
                this,
                platform,
                client
            )
        } else if (client instanceof PlatformEmbeddingsClient) {
            await this.ctx.parallel(
                'chatluna/embeddings-added',
                this,
                platform,
                client
            )
        } else if (client instanceof PlatformModelAndEmbeddingsClient) {
            await this.ctx.parallel(
                'chatluna/embeddings-added',
                this,
                platform,
                client
            )
            await this.ctx.parallel(
                'chatluna/model-added',
                this,
                platform,
                client
            )
        }
    }

    async createClient(platform: string, config: ClientConfig) {
        const createClientFunction =
            PlatformService._createClientFunctions[platform]

        if (!createClientFunction) {
            throw new Error(`Create client function ${platform} not found`)
        }

        const client = createClientFunction(this.ctx, config)

        await this.refreshClient(client, platform, config)

        return client
    }

    async createClients(platform: string) {
        const configPool = PlatformService._configPools[platform]

        if (!configPool) {
            throw new Error(`Config pool ${platform} not found`)
        }

        const configs = configPool.getConfigs()

        const clients: BasePlatformClient[] = []

        for (const config of configs) {
            const client = await this.createClient(platform, config.value)

            if (client == null) {
                continue
            }

            clients.push(client)
            PlatformService._platformClients[
                this._getClientConfigAsKey(config.value)
            ] = client
        }

        return clients
    }

    async getTool(name: string) {
        return PlatformService._tools[name]
    }

    createChatChain(name: string, params: CreateChatHubLLMChainParams) {
        const chatChain = PlatformService._chatChains[name]

        if (!chatChain) {
            throw new Error(`Chat chain ${name} not found`)
        }

        return chatChain.createFunction(params)
    }

    private _getClientConfigAsKey(config: ClientConfig) {
        return `${config.platform}/${config.apiKey}/${config.apiEndpoint}/${config.maxRetries}/${config.concurrentMaxSize}/${config.timeout}`
    }
}

declare module 'koishi' {
    interface Events {
        'chatluna/chat-chain-added': (
            service: PlatformService,
            chain: ChatHubChainInfo
        ) => Promise<void>
        'chatluna/model-added': (
            service: PlatformService,
            platform: PlatformClientNames,
            client: BasePlatformClient | BasePlatformClient[]
        ) => Promise<void>
        'chatluna/embeddings-added': (
            service: PlatformService,
            platform: PlatformClientNames,
            client: BasePlatformClient | BasePlatformClient[]
        ) => Promise<void>
        'chatluna/vector-store-added': (
            service: PlatformService,
            name: string
        ) => Promise<void>
        'chatluna/chat-chain-removed': (
            service: PlatformService,
            chain: ChatHubChainInfo
        ) => Promise<void>
        'chatluna/model-removed': (
            service: PlatformService,
            platform: PlatformClientNames,
            client: BasePlatformClient
        ) => Promise<void>
        'chatluna/vector-store-removed': (
            service: PlatformService,
            name: string
        ) => Promise<void>
        'chatluna/embeddings-removed': (
            service: PlatformService,
            platform: PlatformClientNames,
            client: BasePlatformClient | BasePlatformClient[]
        ) => Promise<void>
        'chatluna/tool-updated': (service: PlatformService) => Promise<void>
    }
}
