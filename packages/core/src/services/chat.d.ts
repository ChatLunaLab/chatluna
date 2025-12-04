import {
    Awaitable,
    Computed,
    Context,
    Dict,
    Schema,
    Service,
    Session
} from 'koishi'
import { ChatInterface } from 'koishi-plugin-chatluna/llm-core/chat/app'
import { Cache } from '../cache'
import { ChatChain } from '../chains/chain'
import { ChatLunaLLMChainWrapper } from 'koishi-plugin-chatluna/llm-core/chain/base'
import { BasePlatformClient } from 'koishi-plugin-chatluna/llm-core/platform/client'
import {
    ClientConfig,
    ClientConfigPool
} from 'koishi-plugin-chatluna/llm-core/platform/config'
import { ChatLunaChatModel } from 'koishi-plugin-chatluna/llm-core/platform/model'
import { PlatformService } from 'koishi-plugin-chatluna/llm-core/platform/service'
import {
    ChatLunaTool,
    CreateChatLunaLLMChainParams,
    CreateVectorStoreFunction,
    PlatformClientNames
} from 'koishi-plugin-chatluna/llm-core/platform/types'
import { PresetService } from 'koishi-plugin-chatluna/preset'
import { ConversationRoom, Message } from '../types'
import { MessageTransformer } from './message_transform'
import { ChatEvents } from './types'
import * as fetchType from 'undici/types/fetch'
import { ClientOptions, WebSocket } from 'ws'
import { ClientRequestArgs } from 'http'
import { Config } from '../config'
import { DefaultRenderer } from '../render'
import type { PostHandler } from '../utils/types'
import { ChatLunaPromptRenderService } from './prompt_renderer'
import { ComputedRef } from '@vue/reactivity'
import { Renderer } from 'koishi-plugin-chatluna'
import { Embeddings } from '@langchain/core/embeddings'
export declare class ChatLunaService extends Service {
    readonly ctx: Context
    config: Config
    private _plugins
    private _chatInterfaceWrapper
    private readonly _chain
    private readonly _keysCache
    private readonly _preset
    private readonly _platformService
    private readonly _messageTransformer
    private readonly _renderer
    private readonly _promptRenderer
    constructor(ctx: Context, config: Config)
    installPlugin(plugin: ChatLunaPlugin): Promise<void>
    awaitLoadPlatform(
        plugin: ChatLunaPlugin | string,
        timeout?: number
    ): Promise<void>

    uninstallPlugin(plugin: ChatLunaPlugin | string): void
    getPlugin(
        platformName: string
    ): ChatLunaPlugin<ClientConfig, ChatLunaPlugin.Config>

    /**
     * @internal
     */
    chat(
        session: Session,
        room: ConversationRoom,
        message: Message,
        event: ChatEvents,
        stream?: boolean,
        variables?: Record<string, any>,
        postHandler?: PostHandler,
        requestId?: string
    ): Promise<Message>

    stopChat(room: ConversationRoom, requestId: string): Promise<boolean>
    queryInterfaceWrapper(
        room: ConversationRoom,
        autoCreate?: boolean
    ): ChatInterfaceWrapper

    clearChatHistory(room: ConversationRoom): Promise<void>
    getCachedInterfaceWrapper(): ChatInterfaceWrapper
    clearCache(room: ConversationRoom): Promise<boolean>
    createChatModel(
        platform: string,
        modelName: string
    ): Promise<ComputedRef<ChatLunaChatModel | undefined>>

    createChatModel(
        fullModelName: string
    ): Promise<ComputedRef<ChatLunaChatModel | undefined>>

    createEmbeddings(
        platformName: string,
        modelName: string
    ): Promise<ComputedRef<Embeddings | undefined>>

    createEmbeddings(
        fullModelName: string
    ): Promise<ComputedRef<Embeddings | undefined>>

    get platform(): PlatformService
    get cache(): Cache<'chatluna/keys', string>
    get preset(): PresetService
    get chatChain(): ChatChain
    get messageTransformer(): MessageTransformer
    get renderer(): DefaultRenderer
    get promptRenderer(): ChatLunaPromptRenderService
    protected stop(): Promise<void>
    private _createTempDir
    private _defineDatabase
    private _createChatInterfaceWrapper
    static inject: string[]
}
export declare class ChatLunaPlugin<
    R extends ClientConfig = ClientConfig,
    T extends ChatLunaPlugin.Config = ChatLunaPlugin.Config
> {
    protected ctx: Context
    readonly config: T
    platformName: PlatformClientNames
    private _supportModels
    readonly platformConfigPool: ClientConfigPool<R>
    private _platformService
    constructor(
        ctx: Context,
        config: T,
        platformName: PlatformClientNames,
        createConfigPool?: boolean
    )

    parseConfig(f: (config: T) => R[]): void
    private createRunnableConfig
    initClient(): Promise<void>
    get supportedModels(): readonly string[]
    registerToService(): void
    registerClient(func: () => BasePlatformClient, platformName?: string): void
    registerVectorStore(name: string, func: CreateVectorStoreFunction): void
    registerTool(name: string, tool: ChatLunaTool): void
    registerChatChainProvider(
        name: string,
        description: Dict<string>,
        func: (params: CreateChatLunaLLMChainParams) => ChatLunaLLMChainWrapper
    ): void

    registerRenderer(
        name: string,
        renderer: (ctx: Context, config: Config) => Renderer
    ): void

    fetch(
        info: fetchType.RequestInfo,
        init?: fetchType.RequestInit,
        proxy?: string
    ): Promise<fetchType.Response>

    ws(url: string, options?: ClientOptions | ClientRequestArgs): WebSocket
}
type ChatHubChatBridgerInfo = {
    chatInterface: ChatInterface
    room: ConversationRoom
}
declare class ChatInterfaceWrapper {
    private _service
    private _conversations
    private _modelQueue
    private _conversationQueue
    private _platformService
    private _requestIdMap
    private _platformToConversations
    constructor(_service: ChatLunaService)
    chat(
        session: Session,
        room: ConversationRoom,
        message: Message,
        event: ChatEvents,
        stream: boolean,
        requestId: string,
        variables?: Record<string, any>,
        postHandler?: PostHandler
    ): Promise<Message>

    stopChat(requestId: string): boolean
    query(room: ConversationRoom, create?: boolean): Promise<ChatInterface>
    clearChatHistory(room: ConversationRoom): Promise<void>
    clearCache(room: ConversationRoom): Promise<boolean>
    getCachedConversations(): [string, ChatHubChatBridgerInfo][]
    delete(room: ConversationRoom): Promise<void>
    dispose(platform?: string): void
    private _createChatInterface
}
export declare namespace ChatLunaPlugin {
    interface Config {
        chatConcurrentMaxSize?: number
        chatTimeLimit?: Computed<Awaitable<number>>
        timeout?: number
        configMode: string
        maxRetries: number
        proxyMode: string
        proxyAddress: string
    }
    const Config: Schema<ChatLunaPlugin.Config>
}
export * from './prompt_renderer'
export * from './types'
export * from './message_transform'
