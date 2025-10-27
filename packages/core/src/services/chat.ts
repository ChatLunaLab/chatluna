import { AIMessage, HumanMessage } from '@langchain/core/messages'
import fs from 'fs'
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
import path from 'path'
import { LRUCache } from 'lru-cache'
import { Cache } from '../cache'
import { ChatChain } from '../chains/chain'
import { ChatLunaLLMChainWrapper } from 'koishi-plugin-chatluna/llm-core/chain/base'
import { BasePlatformClient } from 'koishi-plugin-chatluna/llm-core/platform/client'
import {
    ClientConfig,
    ClientConfigPool,
    ClientConfigPoolMode
} from 'koishi-plugin-chatluna/llm-core/platform/config'
import {
    ChatLunaBaseEmbeddings,
    ChatLunaChatModel
} from 'koishi-plugin-chatluna/llm-core/platform/model'
import { PlatformService } from 'koishi-plugin-chatluna/llm-core/platform/service'
import {
    ChatLunaTool,
    CreateChatLunaLLMChainParams,
    CreateVectorStoreFunction,
    ModelType,
    PlatformClientNames
} from 'koishi-plugin-chatluna/llm-core/platform/types'
import { parseRawModelName } from 'koishi-plugin-chatluna/llm-core/utils/count_tokens'
import { PresetService } from 'koishi-plugin-chatluna/preset'
import { ConversationRoom, Message } from '../types'
import {
    ChatLunaError,
    ChatLunaErrorCode
} from 'koishi-plugin-chatluna/utils/error'
import { RequestIdQueue } from 'koishi-plugin-chatluna/utils/queue'
import { MessageTransformer } from './message_transform'
import { ChatEvents } from './types'
import { chatLunaFetch, ws } from 'koishi-plugin-chatluna/utils/request'
import * as fetchType from 'undici/types/fetch'
import { ClientOptions, WebSocket } from 'ws'
import { ClientRequestArgs } from 'http'
import { Config } from '../config'
import { DefaultRenderer } from '../render'
import type { PostHandler } from '../utils/types'
import { withResolver } from 'koishi-plugin-chatluna/utils/promise'
import { emptyEmbeddings } from 'koishi-plugin-chatluna/llm-core/model/in_memory'
import { ChatLunaPromptRenderService } from './prompt_renderer'
import { computed, ComputedRef, watch } from '@vue/reactivity'
import { Renderer } from 'koishi-plugin-chatluna'
import { Embeddings } from '@langchain/core/embeddings'
import { RunnableConfig } from '@langchain/core/runnables'
import { randomUUID } from 'crypto'

export class ChatLunaService extends Service {
    private _plugins: Record<string, ChatLunaPlugin> = {}
    private _chatInterfaceWrapper: ChatInterfaceWrapper
    private readonly _chain: ChatChain
    private readonly _keysCache: Cache<'chatluna/keys', string>
    private readonly _preset: PresetService
    private readonly _platformService: PlatformService
    private readonly _messageTransformer: MessageTransformer
    private readonly _renderer: DefaultRenderer
    private readonly _promptRenderer: ChatLunaPromptRenderService

    constructor(
        public readonly ctx: Context,
        public config: Config
    ) {
        super(ctx, 'chatluna')
        this._chain = new ChatChain(ctx, config)
        this._keysCache = new Cache(this.ctx, config, 'chatluna/keys')
        this._preset = new PresetService(ctx, config)
        this._platformService = new PlatformService(ctx)
        this._messageTransformer = new MessageTransformer(config)
        this._renderer = new DefaultRenderer(ctx, config)
        this._promptRenderer = new ChatLunaPromptRenderService()

        this._createTempDir()
        this._defineDatabase()
    }

    async installPlugin(plugin: ChatLunaPlugin) {
        const platformName = plugin.platformName

        if (this._plugins[platformName]) {
            throw new ChatLunaError(
                ChatLunaErrorCode.PLUGIN_ALREADY_REGISTERED,
                new Error(`Plugin ${platformName} already registered`)
            )
        }

        this._plugins[platformName] = plugin

        this.ctx.logger.success(`Plugin %c installed`, platformName)
    }

    async awaitLoadPlatform(
        plugin: ChatLunaPlugin | string,
        timeout: number = 30000
    ) {
        const pluginName =
            typeof plugin === 'string' ? plugin : plugin.platformName

        const { promise, resolve, reject } = withResolver<void>()

        // 提前检测，如果已经加载，则直接返回
        const models = this._platformService.listPlatformModels(
            pluginName,
            ModelType.all
        )

        if (models.value.length > 0) {
            resolve()
            return promise
        }

        let timeoutError: Error | null = null

        try {
            throw new Error(
                `Timeout waiting for platform ${pluginName} to load`
            )
        } catch (e) {
            timeoutError = e
        }

        // 添加超时处理
        const timeoutId = this.ctx.setTimeout(() => {
            reject(timeoutError)
        }, timeout)

        const disposable = watch(
            models,
            () => {
                if ((models.value?.length ?? 0) > 0) {
                    resolve()
                    timeoutId()
                    disposable.stop()
                }
            },
            { deep: true }
        )

        this[Context.origin].effect(() => () => disposable.stop())

        return promise
    }

    uninstallPlugin(plugin: ChatLunaPlugin | string) {
        const platformName =
            typeof plugin === 'string' ? plugin : plugin.platformName

        const targetPlugin = this._plugins[platformName]

        if (!targetPlugin) {
            // this.ctx.logger.warn('Plugin %c not found', platformName)
            return
        }

        const platform = targetPlugin.platformName

        this._chatInterfaceWrapper?.dispose(platform)

        delete this._plugins[platform]

        this.ctx.logger.success(
            'Plugin %c uninstalled',
            targetPlugin.platformName
        )
    }

    getPlugin(platformName: string) {
        return this._plugins[platformName]
    }

    /**
     * @internal
     */
    chat(
        session: Session,
        room: ConversationRoom,
        message: Message,
        event: ChatEvents,
        stream: boolean = false,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        variables: Record<string, any> = {},
        postHandler?: PostHandler,
        requestId: string = randomUUID()
    ) {
        const chatInterfaceWrapper =
            this._chatInterfaceWrapper ?? this._createChatInterfaceWrapper()

        return chatInterfaceWrapper.chat(
            session,
            room,
            message,
            event,
            stream,
            requestId,
            variables,
            postHandler
        )
    }

    async stopChat(room: ConversationRoom, requestId: string) {
        const chatInterfaceWrapper = this.queryInterfaceWrapper(room, false)

        if (chatInterfaceWrapper == null) {
            return undefined
        }

        return chatInterfaceWrapper.stopChat(requestId)
    }

    queryInterfaceWrapper(room: ConversationRoom, autoCreate: boolean = true) {
        return (
            this._chatInterfaceWrapper ??
            (autoCreate ? this._createChatInterfaceWrapper() : undefined)
        )
    }

    async clearChatHistory(room: ConversationRoom) {
        const chatBridger =
            this._chatInterfaceWrapper ?? this._createChatInterfaceWrapper()

        return chatBridger.clearChatHistory(room)
    }

    getCachedInterfaceWrapper() {
        return this._chatInterfaceWrapper
    }

    async clearCache(room: ConversationRoom) {
        const chatBridger =
            this._chatInterfaceWrapper ?? this._createChatInterfaceWrapper()

        return chatBridger.clearCache(room)
    }

    async createChatModel(
        platform: string,
        modelName: string
    ): Promise<ComputedRef<ChatLunaChatModel | undefined>>

    async createChatModel(
        fullModelName: string
    ): Promise<ComputedRef<ChatLunaChatModel | undefined>>

    async createChatModel(platformName: string, model?: string) {
        const service = this._platformService

        if (model == null) {
            ;[platformName, model] = parseRawModelName(platformName)
        }

        const client = await service.getClient(platformName)

        return computed(() => {
            if (client.value == null) {
                return undefined
            }
            return client.value.createModel(model) as ChatLunaChatModel
        })
    }

    async createEmbeddings(
        platformName: string,
        modelName: string
    ): Promise<ComputedRef<Embeddings | undefined>>

    async createEmbeddings(
        fullModelName: string
    ): Promise<ComputedRef<Embeddings | undefined>>

    async createEmbeddings(platformName: string, modelName?: string) {
        const service = this._platformService

        if (modelName == null) {
            ;[platformName, modelName] = parseRawModelName(platformName)
        }

        const client = await service.getClient(platformName)

        return computed(() => {
            if (client.value == null) {
                if (platformName !== '无') {
                    this.ctx.logger.warn(
                        `The platform ${platformName} no available`
                    )
                }
                return emptyEmbeddings
            }

            const model = client.value.createModel(modelName)

            if (model instanceof ChatLunaBaseEmbeddings) {
                return model
            }

            this.ctx.logger.warn(
                `The model ${modelName} is not embeddings, return empty embeddings`
            )
            return emptyEmbeddings
        })
    }

    get platform() {
        return this._platformService
    }

    get cache() {
        return this._keysCache
    }

    get preset() {
        return this._preset
    }

    get chatChain() {
        return this._chain
    }

    get messageTransformer() {
        return this._messageTransformer
    }

    get renderer() {
        return this._renderer
    }

    get promptRenderer() {
        return this._promptRenderer
    }

    protected async stop(): Promise<void> {
        this._chatInterfaceWrapper?.dispose()
        this._platformService.dispose()
    }

    private _createTempDir() {
        // create dir data/chathub/temp use fs
        // ?
        const tempPath = path.resolve(this.ctx.baseDir, 'data/chatluna/temp')
        if (!fs.existsSync(tempPath)) {
            fs.mkdirSync(tempPath, { recursive: true })
        }
    }

    private _defineDatabase() {
        const ctx = this.ctx

        ctx.database.extend(
            'chathub_conversation',
            {
                id: {
                    type: 'char',
                    length: 255
                },
                latestId: {
                    type: 'char',
                    length: 255,
                    nullable: true
                },
                additional_kwargs: {
                    type: 'text',
                    nullable: true
                },
                updatedAt: {
                    type: 'timestamp',
                    nullable: false,
                    initial: new Date()
                }
            },
            {
                autoInc: false,
                primary: 'id',
                unique: ['id']
            }
        )

        ctx.database.extend(
            'chathub_message',
            {
                id: {
                    type: 'char',
                    length: 255
                },
                text: 'text',
                parent: {
                    type: 'char',
                    length: 255,
                    nullable: true
                },
                role: {
                    type: 'char',
                    length: 20
                },
                conversation: {
                    type: 'char',
                    length: 255
                },
                additional_kwargs: {
                    type: 'text',
                    nullable: true
                },
                additional_kwargs_binary: {
                    type: 'binary',
                    nullable: true
                },
                tool_call_id: 'string',
                tool_calls: 'json',
                name: {
                    type: 'char',
                    length: 255,
                    nullable: true
                },
                rawId: {
                    type: 'char',
                    length: 255,
                    nullable: true
                }
            },
            {
                autoInc: false,
                primary: 'id',
                unique: ['id']
                /*  foreign: {
                 conversation: ['chathub_conversaion', 'id']
             } */
            }
        )

        ctx.database.extend(
            'chathub_room',
            {
                roomId: {
                    type: 'integer'
                },
                roomName: 'string',
                conversationId: {
                    type: 'char',
                    length: 255,
                    nullable: true
                },

                roomMasterId: {
                    type: 'char',
                    length: 255
                },
                visibility: {
                    type: 'char',
                    length: 20
                },
                preset: {
                    type: 'char',
                    length: 255
                },
                model: {
                    type: 'char',
                    length: 100
                },
                chatMode: {
                    type: 'char',
                    length: 20
                },
                password: {
                    type: 'char',
                    length: 100
                },
                autoUpdate: {
                    type: 'boolean',
                    initial: false
                },
                updatedTime: {
                    type: 'timestamp',
                    nullable: false,
                    initial: new Date()
                }
            },
            {
                autoInc: false,
                primary: 'roomId',
                unique: ['roomId']
            }
        )

        ctx.database.extend(
            'chathub_room_member',
            {
                userId: {
                    type: 'string',
                    length: 255
                },
                roomId: {
                    type: 'integer'
                },
                roomPermission: {
                    type: 'char',
                    length: 50
                },
                mute: {
                    type: 'boolean',
                    initial: false
                }
            },
            {
                autoInc: false,
                primary: ['userId', 'roomId']
            }
        )

        ctx.database.extend(
            'chathub_room_group_member',
            {
                groupId: {
                    type: 'char',
                    length: 255
                },
                roomId: {
                    type: 'integer'
                },
                roomVisibility: {
                    type: 'char',
                    length: 20
                }
            },
            {
                autoInc: false,
                primary: ['groupId', 'roomId']
            }
        )

        ctx.database.extend(
            'chathub_user',
            {
                userId: {
                    type: 'char',
                    length: 255
                },
                defaultRoomId: {
                    type: 'integer'
                },
                groupId: {
                    type: 'char',
                    length: 255,
                    nullable: true
                }
            },
            {
                autoInc: false,
                primary: ['userId', 'groupId']
            }
        )

        ctx.database.extend(
            'chatluna_docstore',
            {
                key: {
                    type: 'char',
                    length: 255
                },
                id: {
                    type: 'char',
                    length: 255
                },
                pageContent: 'text',
                metadata: 'json',
                createdAt: 'date'
            },
            {
                autoInc: false,
                primary: ['key', 'id']
            }
        )
    }

    private _createChatInterfaceWrapper(): ChatInterfaceWrapper {
        const chatBridger = new ChatInterfaceWrapper(this)
        this._chatInterfaceWrapper = chatBridger
        return chatBridger
    }

    static inject = ['database']
}

export class ChatLunaPlugin<
    R extends ClientConfig = ClientConfig,
    T extends ChatLunaPlugin.Config = ChatLunaPlugin.Config
> {
    private _supportModels: string[] = []

    public readonly platformConfigPool: ClientConfigPool<R>

    private _platformService: PlatformService

    constructor(
        protected ctx: Context,
        public readonly config: T,
        public platformName: PlatformClientNames,
        createConfigPool: boolean = true
    ) {
        ctx.on('dispose', async () => {
            ctx.chatluna.uninstallPlugin(this)
        })

        ctx.on('ready', async () => {
            ctx.chatluna.installPlugin(this)
        })

        if (createConfigPool) {
            if (config == null) {
                const error = new Error('Check Config!')

                // unstable code
                this.ctx.scope.cancel(error)
                throw error
            }

            this.platformConfigPool = new ClientConfigPool<R>(
                ctx,
                config.configMode === 'default'
                    ? ClientConfigPoolMode.AlwaysTheSame
                    : ClientConfigPoolMode.LoadBalancing
            )
        }

        this._platformService = ctx.chatluna.platform

        const models = this._platformService.listPlatformModels(
            this.platformName,
            ModelType.llm
        )

        const watcher = watch(
            models,
            () => {
                this._supportModels = (models.value ?? []).map(
                    (model) => `${this.platformName}/${model.name}`
                )
            },
            { deep: true }
        )

        const stop = () => watcher.stop()

        this.ctx.effect(() => stop)
    }

    parseConfig(f: (config: T) => R[]) {
        const configs = f(this.config)

        for (const config of configs) {
            this.platformConfigPool.addConfig(config)
        }
    }

    private createRunnableConfig(): RunnableConfig {
        const abortController = new AbortController()

        const abort = () =>
            abortController.abort(
                new ChatLunaError(ChatLunaErrorCode.ABORTED, undefined, true)
            )

        this.ctx.effect(() => abort)

        return {
            signal: abortController.signal
        }
    }

    async initClient() {
        try {
            await this._platformService.createClient(
                this.platformName,
                this.createRunnableConfig()
            )
        } catch (e) {
            this.ctx.chatluna.uninstallPlugin(this)

            // unstable code
            this.ctx.scope.cancel(e)

            throw e
        }
    }

    get supportedModels(): readonly string[] {
        return this._supportModels
    }

    registerToService() {
        try {
            throw new Error('Please remove this method')
        } catch (e) {
            this.ctx.logger.warn(
                `Now the plugin support auto installation, Please remove call this method`,
                e
            )
        }
    }

    registerClient(
        func: () => BasePlatformClient,
        platformName: string = this.platformName
    ) {
        this.ctx.effect(() =>
            this._platformService.registerClient(platformName, func)
        )
    }

    registerVectorStore(name: string, func: CreateVectorStoreFunction) {
        this.ctx.effect(() =>
            this._platformService.registerVectorStore(name, func)
        )
    }

    registerTool(name: string, tool: ChatLunaTool) {
        this.ctx.effect(() => this._platformService.registerTool(name, tool))
    }

    registerChatChainProvider(
        name: string,
        description: Dict<string>,
        func: (params: CreateChatLunaLLMChainParams) => ChatLunaLLMChainWrapper
    ) {
        this.ctx.effect(() =>
            this._platformService.registerChatChain(name, description, func)
        )
    }

    registerRenderer(
        name: string,
        renderer: (ctx: Context, config: Config) => Renderer
    ) {
        this.ctx.effect(() =>
            this.ctx.chatluna.renderer.addRenderer(name, renderer)
        )
    }

    async fetch(
        info: fetchType.RequestInfo,
        init?: fetchType.RequestInit,
        proxy?: string
    ) {
        if (proxy != null) {
            return chatLunaFetch(info, init, proxy)
        }

        const proxyMode = this.config.proxyMode

        switch (proxyMode) {
            case 'system':
                return chatLunaFetch(info, init)
            case 'off':
                return chatLunaFetch(info, init, 'null')
            case 'on':
                return chatLunaFetch(info, init, this.config.proxyAddress)
            default:
                return chatLunaFetch(info, init)
        }
    }

    ws(url: string, options?: ClientOptions | ClientRequestArgs): WebSocket {
        const proxyMode = this.config.proxyMode

        let webSocket: WebSocket

        switch (proxyMode) {
            case 'system':
                webSocket = ws(url, options)
                break
            case 'off':
                webSocket = ws(url, options, 'null')
                break
            case 'on':
                webSocket = ws(url, options, this.config.proxyAddress)
                break
            default:
                webSocket = ws(url, options)
                break
        }

        this.ctx.effect(() => webSocket.close)

        webSocket.on('error', (err) => {
            this.ctx.logger.error(err)
        })

        return webSocket
    }
}

type ChatHubChatBridgerInfo = {
    chatInterface: ChatInterface
    room: ConversationRoom
}

class ChatInterfaceWrapper {
    private _conversations: LRUCache<string, ChatHubChatBridgerInfo> =
        new LRUCache({
            max: 20
        })

    private _modelQueue = new RequestIdQueue()
    private _conversationQueue = new RequestIdQueue()
    private _platformService: PlatformService

    private _requestIdMap: Map<string, AbortController> = new Map()
    private _platformToConversations: Map<string, string[]> = new Map()

    constructor(private _service: ChatLunaService) {
        this._platformService = _service.platform
    }

    async chat(
        session: Session,
        room: ConversationRoom,
        message: Message,
        event: ChatEvents,
        stream: boolean,
        requestId: string,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        variables: Record<string, any> = {},
        postHandler?: PostHandler
    ): Promise<Message> {
        const { conversationId, model: fullModelName } = room
        const [platform] = parseRawModelName(fullModelName)
        const client = await this._platformService.getClient(platform)
        if (client.value == null) {
            await this._service.awaitLoadPlatform(platform)
        }
        if (client.value == null) {
            throw new ChatLunaError(
                ChatLunaErrorCode.UNKNOWN_ERROR,
                new Error(`Platform ${platform} is not available`)
            )
        }
        const config = client.value.configPool.getConfig(true).value

        try {
            // Add to queues
            await Promise.all([
                this._conversationQueue.add(conversationId, requestId),
                this._modelQueue.add(platform, requestId)
            ])

            const currentQueueLength =
                await this._conversationQueue.getQueueLength(conversationId)
            await event['llm-queue-waiting'](currentQueueLength)

            // Wait for our turn
            await Promise.all([
                this._conversationQueue.wait(conversationId, requestId, 0),
                this._modelQueue.wait(
                    platform,
                    requestId,
                    config.concurrentMaxSize
                )
            ])

            // Track conversation
            const conversationIds =
                this._platformToConversations.get(platform) ?? []
            conversationIds.push(conversationId)
            this._platformToConversations.set(platform, conversationIds)

            const { chatInterface } =
                this._conversations.get(conversationId) ??
                (await this._createChatInterface(room))

            const abortController = new AbortController()
            this._requestIdMap.set(requestId, abortController)

            const humanMessage = new HumanMessage({
                content: message.content,
                name: message.name,
                id: session.userId,
                additional_kwargs: {
                    ...message.additional_kwargs,
                    preset: room.preset
                }
            })

            const chainValues = await chatInterface.chat({
                message: humanMessage,
                events: event,
                stream,
                conversationId,
                session,
                variables,
                signal: abortController.signal,
                postHandler
            })

            const aiMessage = chainValues.message as AIMessage

            const reasoningContent = aiMessage.additional_kwargs
                ?.reasoning_content as string

            const reasoningTime = aiMessage.additional_kwargs
                ?.reasoning_time as number

            const additionalReplyMessages: Message[] = []

            if (
                reasoningContent != null &&
                reasoningContent.length > 0 &&
                this._service.config.showThoughtMessage
            ) {
                additionalReplyMessages.push({
                    content: `Thought for ${reasoningTime / 1000} seconds: \n\n${reasoningContent}`
                })
            }

            return {
                content: aiMessage.content as string,
                additionalReplyMessages
            }
        } finally {
            // Clean up resources
            await Promise.all([
                this._modelQueue.remove(platform, requestId),
                this._conversationQueue.remove(conversationId, requestId)
            ])
            this._requestIdMap.delete(requestId)
        }
    }

    stopChat(requestId: string) {
        const abortController = this._requestIdMap.get(requestId)
        if (!abortController) {
            return false
        }
        abortController.abort(
            new ChatLunaError(ChatLunaErrorCode.ABORTED, undefined, true)
        )
        this._requestIdMap.delete(requestId)
        return true
    }

    async query(
        room: ConversationRoom,
        create: boolean = false
    ): Promise<ChatInterface> {
        const { conversationId } = room

        const { chatInterface } = this._conversations.get(conversationId) ?? {}

        if (chatInterface == null && create) {
            return this._createChatInterface(room).then(
                (result) => result.chatInterface
            )
        }

        return chatInterface
    }

    async clearChatHistory(room: ConversationRoom) {
        const { conversationId } = room
        const requestId = randomUUID()

        try {
            await this._conversationQueue.add(conversationId, requestId)
            await this._conversationQueue.wait(conversationId, requestId, 0)

            const chatInterface = await this.query(room, true)
            await chatInterface.clearChatHistory()
        } finally {
            this._conversations.delete(conversationId)
            await this._conversationQueue.remove(conversationId, requestId)
        }
    }

    async clearCache(room: ConversationRoom) {
        const { conversationId } = room
        const requestId = randomUUID()

        try {
            await this._conversationQueue.add(conversationId, requestId)
            await this._conversationQueue.wait(conversationId, requestId, 0)

            const chatInterface = await this.query(room)

            await this._service.ctx.root.parallel(
                'chatluna/clear-chat-history',
                conversationId,
                chatInterface
            )

            return this._conversations.delete(conversationId)
        } finally {
            await this._conversationQueue.remove(conversationId, requestId)
        }
    }

    getCachedConversations(): [string, ChatHubChatBridgerInfo][] {
        return Array.from(this._conversations.entries())
    }

    async delete(room: ConversationRoom) {
        const { conversationId } = room
        const requestId = randomUUID()

        try {
            await this._conversationQueue.add(conversationId, requestId)
            await this._conversationQueue.wait(conversationId, requestId, 1)

            const chatInterface = await this.query(room)
            if (!chatInterface) return

            await chatInterface.delete(this._service.ctx, room)
            await this.clearCache(room)
        } finally {
            await this._conversationQueue.remove(conversationId, requestId)
        }
    }

    dispose(platform?: string) {
        // Terminate all related requests
        for (const controller of this._requestIdMap.values()) {
            controller.abort(
                new ChatLunaError(ChatLunaErrorCode.ABORTED, undefined, true)
            )
        }

        if (!platform) {
            // Clean up all resources
            this._conversations.clear()
            this._requestIdMap.clear()
            this._platformToConversations.clear()
            return
        }

        // Clean up resources for specific platform
        const conversationIds = this._platformToConversations.get(platform)
        if (!conversationIds?.length) return

        for (const conversationId of conversationIds) {
            this._conversations.delete(conversationId)
        }

        this._platformToConversations.delete(platform)
    }

    private async _createChatInterface(
        room: ConversationRoom
    ): Promise<ChatHubChatBridgerInfo> {
        const config = this._service.config

        const chatInterface = new ChatInterface(this._service.ctx.root, {
            chatMode: room.chatMode,
            botName: config.botNames[0],
            preset: this._service.preset.getPreset(room.preset),
            model: room.model,
            conversationId: room.conversationId,
            embeddings:
                config.defaultEmbeddings && config.defaultEmbeddings.length > 0
                    ? config.defaultEmbeddings
                    : undefined,
            vectorStoreName:
                config.defaultVectorStore &&
                config.defaultVectorStore.length > 0
                    ? config.defaultVectorStore
                    : undefined
        })

        const result = {
            chatInterface,
            room
        }

        this._conversations.set(room.conversationId, result)

        return result
    }
}

// eslint-disable-next-line @typescript-eslint/no-namespace
export namespace ChatLunaPlugin {
    export interface Config {
        chatConcurrentMaxSize?: number
        chatTimeLimit?: Computed<Awaitable<number>>
        timeout?: number
        configMode: string
        maxRetries: number
        proxyMode: string
        proxyAddress: string
    }

    export const Config: Schema<ChatLunaPlugin.Config> = Schema.intersect([
        Schema.object({
            chatConcurrentMaxSize: Schema.number().min(1).max(8).default(3),
            chatTimeLimit: Schema.computed(
                Schema.number().min(1).max(2000)
            ).default(200),
            configMode: Schema.union([
                Schema.const('default'),
                Schema.const('balance')
            ]).default('default'),
            maxRetries: Schema.number().min(1).max(6).default(3),
            timeout: Schema.number().default(300 * 1000),
            proxyMode: Schema.union([
                Schema.const('system'),
                Schema.const('off'),
                Schema.const('on')
            ]).default('system')
        }),
        Schema.union([
            Schema.object({
                proxyMode: Schema.const('on').required(),
                proxyAddress: Schema.string().default('')
            }),
            Schema.object({
                proxyMode: Schema.const('off').required()
            }),
            Schema.object({
                proxyMode: Schema.const('system')
            })
        ])
    ]).i18n({
        'zh-CN': require('../locales/zh-CN.schema.plugin.yml'),
        'en-US': require('../locales/en-US.schema.plugin.yml')
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
    }) as any
}

export * from './prompt_renderer'
export * from './types'
export * from './message_transform'
