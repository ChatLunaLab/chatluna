import { Context, Dict } from 'koishi'
import {
    BasePlatformClient,
    PlatformEmbeddingsClient,
    PlatformModelAndEmbeddingsClient,
    PlatformModelClient
} from 'koishi-plugin-chatluna/llm-core/platform/client'
import {
    ChatLunaChainInfo,
    ChatLunaTool,
    CreateChatLunaLLMChainParams,
    CreateClientFunction,
    CreateToolParams,
    CreateVectorStoreFunction,
    CreateVectorStoreParams,
    ModelInfo,
    ModelType,
    PlatformClientNames,
    PlatformModelInfo
} from 'koishi-plugin-chatluna/llm-core/platform/types'
import { ChatLunaLLMChainWrapper } from '../chain/base'
import { LRUCache } from 'lru-cache'
import { ChatLunaSaveableVectorStore } from 'koishi-plugin-chatluna/llm-core/vectorstores'
import { parseRawModelName } from 'koishi-plugin-chatluna/llm-core/utils/count_tokens'
import { StructuredTool } from '@langchain/core/tools'
import { computed, ComputedRef, reactive } from '@vue/reactivity'
import { randomUUID } from 'crypto'
import { RunnableConfig } from '@langchain/core/runnables'

export class PlatformService {
    private _platformClients: Record<string, BasePlatformClient> = reactive({})
    private _createClientFunctions: Record<string, CreateClientFunction> =
        reactive({})

    private _tools: Record<string, ChatLunaTool> = reactive({})
    private _tmpTools: Record<string, StructuredTool> = reactive({})
    private _models: Record<string, ModelInfo[]> = reactive({})
    private _chatChains: Record<string, ChatLunaChainInfo> = reactive({})
    private _vectorStore: Record<string, CreateVectorStoreFunction> = reactive(
        {}
    )

    private _tmpVectorStores = new LRUCache<
        string,
        ChatLunaSaveableVectorStore
    >({
        max: 20,
        dispose: (value) => {
            value.free?.()
        }
    })

    constructor(private ctx: Context) {
        this.ctx.on('chatluna/clear-chat-history', async (conversationId) => {
            this._tmpVectorStores.clear()
        })
    }

    registerClient(
        name: PlatformClientNames,
        createClientFunction: CreateClientFunction
    ) {
        if (this._createClientFunctions[name]) {
            throw new Error(`Client ${name} already exists`)
        }
        this._createClientFunctions[name] = createClientFunction
        return () => this.unregisterClient(name)
    }

    registerTool(name: string, toolCreator: ChatLunaTool) {
        toolCreator.id = randomUUID()
        toolCreator.name = name
        this._tools[name] = toolCreator
        delete this._tmpTools[name]
        this.ctx.emit('chatluna/tool-updated', this)
        return () => this.unregisterTool(name)
    }

    unregisterTool(name: string) {
        delete this._tools[name]
        delete this._tmpTools[name]
        this.ctx.emit('chatluna/tool-updated', this)
    }

    unregisterClient(platform: PlatformClientNames) {
        delete this._models[platform]

        const client = this._platformClients[platform]

        if (client == null) {
            delete this._createClientFunctions[platform]
            return
        }

        delete this._platformClients[platform]

        if (client instanceof PlatformModelClient) {
            this.ctx.emit('chatluna/model-removed', this, platform, client)
        } else if (client instanceof PlatformEmbeddingsClient) {
            this.ctx.emit('chatluna/embeddings-removed', this, platform, client)
        } else if (client instanceof PlatformModelAndEmbeddingsClient) {
            this.ctx.emit('chatluna/embeddings-removed', this, platform, client)
            this.ctx.emit('chatluna/model-removed', this, platform, client)
        }

        delete this._createClientFunctions[platform]
    }

    unregisterVectorStore(name: string) {
        delete this._vectorStore[name]
        this.ctx.emit('chatluna/vector-store-removed', this, name)
    }

    registerVectorStore(
        name: string,
        vectorStoreRetrieverCreator: CreateVectorStoreFunction
    ) {
        this._vectorStore[name] = vectorStoreRetrieverCreator
        this.ctx.emit('chatluna/vector-store-added', this, name)
        return () => this.unregisterVectorStore(name)
    }

    registerChatChain(
        name: string,
        description: Dict<string>,
        createChatChainFunction: (
            params: CreateChatLunaLLMChainParams
        ) => ChatLunaLLMChainWrapper
    ) {
        this._chatChains[name] = {
            name,
            description,
            createFunction: createChatChainFunction
        }
        this.ctx.emit('chatluna/chat-chain-added', this, this._chatChains[name])
        return () => this.unregisterChatChain(name)
    }

    unregisterChatChain(name: string) {
        const chain = this._chatChains[name]
        delete this._chatChains[name]
        this.ctx.emit('chatluna/chat-chain-removed', this, chain)
    }

    listPlatformModels(platform: PlatformClientNames, type: ModelType) {
        return computed(() => {
            const models = this._models[platform] ?? []

            if (models.length === 0) {
                return [] as ModelInfo[]
            }

            return models
                .filter((m) => type === ModelType.all || m.type === type)
                .sort((a, b) => {
                    if (!a?.name || !b?.name) return 0
                    return a.name.localeCompare(b.name, undefined, {
                        numeric: true,
                        sensitivity: 'base'
                    })
                })
        })
    }

    findModel(fullModelName: string): ComputedRef<ModelInfo | null>
    findModel(platform: string, name: string): ComputedRef<ModelInfo | null>

    findModel(platform: string, name?: string): ComputedRef<ModelInfo | null> {
        if (name == null) {
            ;[platform, name] = parseRawModelName(platform)
        }

        return computed(
            () => this._models[platform]?.find((m) => m.name === name) ?? null
        )
    }

    getTools() {
        return computed(() => Object.keys(this._tools))
    }

    listAllModels(type: ModelType) {
        return computed(() => {
            const allModel: PlatformModelInfo[] = []

            for (const platform in this._models) {
                const models = this._models[platform]

                for (const model of models) {
                    if (type === ModelType.all || model.type === type) {
                        allModel.push({
                            ...model,
                            platform,
                            toModelName: () => platform + '/' + model.name
                        })
                    }
                }
            }

            return allModel.sort()
        })
    }

    get vectorStores() {
        return computed(() => Object.keys(this._vectorStore))
    }

    get chatChains() {
        return computed(() => Object.values(this._chatChains))
    }

    async createVectorStore(name: string, params: CreateVectorStoreParams) {
        const vectorStoreRetriever = this._vectorStore[name]

        if (!vectorStoreRetriever) {
            throw new Error(`Vector store retriever ${name} not found`)
        }

        const key = params.key

        if (key == null) {
            return await vectorStoreRetriever(params)
        }

        const cacheVectorStore = this._tmpVectorStores.get(key)

        if (cacheVectorStore) {
            return cacheVectorStore
        }

        const vectorStore = await vectorStoreRetriever(params)

        this._tmpVectorStores.set(key, vectorStore)
        return vectorStore
    }

    async getClient(platform: string) {
        if (!this._platformClients[platform]) {
            await this.createClient(platform)
        }

        return computed(() => this._platformClients[platform])
    }

    async refreshClient(
        client: BasePlatformClient,
        platform: string,
        config?: RunnableConfig
    ) {
        const isAvailable = await client.isAvailable(config)

        if (!isAvailable) {
            return
        }

        const models = await client.getModels(config)

        if (models == null) {
            return
        }

        const availableModels = this._models[platform] ?? []

        // filter existing models
        this._models[platform] = availableModels.concat(
            models.filter(
                (m) => !availableModels.some((am) => am.name === m.name)
            )
        )

        if (client instanceof PlatformModelClient) {
            this.ctx.emit('chatluna/model-added', this, platform, client)
        } else if (client instanceof PlatformEmbeddingsClient) {
            this.ctx.emit('chatluna/embeddings-added', this, platform, client)
        } else if (client instanceof PlatformModelAndEmbeddingsClient) {
            this.ctx.emit('chatluna/embeddings-added', this, platform, client)
            this.ctx.emit('chatluna/model-added', this, platform, client)
        }
    }

    async createClient(platform: string, config?: RunnableConfig) {
        const createClientFunction = this._createClientFunctions[platform]

        if (!createClientFunction) {
            return
        }

        if (this._platformClients[platform]) {
            this.ctx.logger.warn(
                `Client ${platform} already exists, skip creating`
            )
            return this._platformClients[platform]
        }

        const client = createClientFunction()

        await this.refreshClient(client, platform, config)

        this._platformClients[platform] = client

        return client
    }

    getTool(name: string) {
        const tool = this._tools[name]
        // eslint-disable-next-line @typescript-eslint/no-this-alias
        const that = this
        return {
            ...tool,
            createTool(params) {
                return that._createTool(name, params)
            }
        } satisfies ChatLunaTool
    }

    private _createTool(name: string, params: CreateToolParams) {
        if (this._tmpTools[name]) {
            return this._tmpTools[name]
        }
        const chatLunaTool = this._tools[name]
        if (chatLunaTool == null) {
            throw new Error(`Tool ${name} not found`)
        }
        const tool = chatLunaTool.createTool(params)
        this._tmpTools[name] = tool
        return tool
    }

    createChatChain(name: string, params: CreateChatLunaLLMChainParams) {
        const chatChain = this._chatChains[name]

        if (!chatChain) {
            throw new Error(`Chat chain ${name} not found`)
        }

        return chatChain.createFunction(params)
    }

    dispose() {
        this._tmpVectorStores.clear()
        this._platformClients = reactive({})
        this._models = reactive({})
        this._tools = reactive({})
        this._chatChains = reactive({})
    }
}

declare module 'koishi' {
    interface Events {
        'chatluna/chat-chain-added': (
            service: PlatformService,
            chain: ChatLunaChainInfo
        ) => void
        'chatluna/model-added': (
            service: PlatformService,
            platform: PlatformClientNames,
            client: BasePlatformClient | BasePlatformClient[]
        ) => void
        'chatluna/embeddings-added': (
            service: PlatformService,
            platform: PlatformClientNames,
            client: BasePlatformClient | BasePlatformClient[]
        ) => void
        'chatluna/vector-store-added': (
            service: PlatformService,
            name: string
        ) => void
        'chatluna/chat-chain-removed': (
            service: PlatformService,
            chain: ChatLunaChainInfo
        ) => void
        'chatluna/model-removed': (
            service: PlatformService,
            platform: PlatformClientNames,
            client: BasePlatformClient
        ) => void
        'chatluna/vector-store-removed': (
            service: PlatformService,
            name: string
        ) => void
        'chatluna/embeddings-removed': (
            service: PlatformService,
            platform: PlatformClientNames,
            client: BasePlatformClient | BasePlatformClient[]
        ) => void
        'chatluna/tool-updated': (service: PlatformService) => void
    }
}
