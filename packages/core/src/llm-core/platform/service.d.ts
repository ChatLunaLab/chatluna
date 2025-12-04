import { Context, Dict } from 'koishi'
import { BasePlatformClient } from 'koishi-plugin-chatluna/llm-core/platform/client'
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
import { ChatLunaSaveableVectorStore } from 'koishi-plugin-chatluna/llm-core/vectorstores'
import { StructuredTool } from '@langchain/core/tools'
import { ComputedRef } from '@vue/reactivity'
import { RunnableConfig } from '@langchain/core/runnables'
export declare class PlatformService {
    private ctx
    private _platformClients
    private _createClientFunctions
    private _tools
    private _tmpTools
    private _models
    private _chatChains
    private _vectorStore
    private _tmpVectorStores
    constructor(ctx: Context)
    registerClient(
        name: PlatformClientNames,
        createClientFunction: CreateClientFunction
    ): () => void

    registerTool(name: string, toolCreator: ChatLunaTool): () => void
    unregisterTool(name: string): void
    unregisterClient(platform: PlatformClientNames): void
    unregisterVectorStore(name: string): void
    registerVectorStore(
        name: string,
        vectorStoreRetrieverCreator: CreateVectorStoreFunction
    ): () => void

    registerChatChain(
        name: string,
        description: Dict<string>,
        createChatChainFunction: (
            params: CreateChatLunaLLMChainParams
        ) => ChatLunaLLMChainWrapper
    ): () => void

    unregisterChatChain(name: string): void
    listPlatformModels(
        platform: PlatformClientNames,
        type: ModelType
    ): ComputedRef<ModelInfo[]>

    findModel(fullModelName: string): ComputedRef<ModelInfo | null>
    findModel(platform: string, name: string): ComputedRef<ModelInfo | null>
    getTools(): ComputedRef<string[]>
    listAllModels(type: ModelType): ComputedRef<PlatformModelInfo[]>
    get vectorStores(): ComputedRef<string[]>
    get chatChains(): ComputedRef<ChatLunaChainInfo[]>
    createVectorStore(
        name: string,
        params: CreateVectorStoreParams
    ): Promise<
        ChatLunaSaveableVectorStore<
            import('@langchain/core/vectorstores').VectorStore
        >
    >

    getClient(
        platform: string
    ): Promise<
        ComputedRef<
            BasePlatformClient<
                import('./config').ClientConfig,
                | import('./model').ChatLunaChatModel
                | import('./model').ChatLunaBaseEmbeddings
            >
        >
    >

    refreshClient(
        client: BasePlatformClient,
        platform: string,
        config?: RunnableConfig
    ): Promise<void>

    createClient(
        platform: string,
        config?: RunnableConfig
    ): Promise<
        BasePlatformClient<
            import('./config').ClientConfig,
            | import('./model').ChatLunaChatModel
            | import('./model').ChatLunaBaseEmbeddings
        >
    >

    getTool(name: string): {
        createTool(
            params: CreateToolParams
        ): StructuredTool<
            import('@langchain/core/tools').ToolSchemaBase,
            any,
            any,
            any
        >
        selector: (
            history: import('@langchain/core/messages').BaseMessage[]
        ) => boolean
        authorization?: (session: import('koishi').Session) => boolean
        name?: string
        id?: string
    }

    private _createTool
    createChatChain(
        name: string,
        params: CreateChatLunaLLMChainParams
    ): ChatLunaLLMChainWrapper

    dispose(): void
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
