import {
    Awaitable,
    Computed,
    Context,
    Schema,
    Service,
    Session,
    sleep
} from 'koishi'
import { Config } from '../config'
import { PromiseLikeDisposable } from '../utils/types'
import { ChatInterface } from '../llm-core/chat/app'
import { ConversationRoom, Message } from '../types'
import { AIMessage, HumanMessage } from '@langchain/core/messages'
import { formatPresetTemplate, PresetTemplate } from '../llm-core/prompt'
import { v4 as uuidv4 } from 'uuid'
import fs from 'fs'
import path from 'path'
import {
    ChatHubTool,
    CreateChatHubLLMChainParams,
    CreateVectorStoreFunction,
    ModelType,
    PlatformClientNames
} from '../llm-core/platform/types'
import {
    ClientConfig,
    ClientConfigPool,
    ClientConfigPoolMode
} from '../llm-core/platform/config'
import { BasePlatformClient } from '../llm-core/platform/client'
import {
    ChatHubBaseEmbeddings,
    ChatLunaChatModel
} from '../llm-core/platform/model'
import { ChatHubLLMChainWrapper } from '../llm-core/chain/base'
import { ChatEvents } from './types'
import { parseRawModelName } from '../llm-core/utils/count_tokens'
import { ChatLunaError, ChatLunaErrorCode } from '../utils/error'
import { RequestIdQueue } from '../utils/queue'
import { ObjectLock } from '../utils/lock'
import { ChatChain } from '../chains/chain'
import { PresetService } from '../preset'
import { Cache } from '../cache'
import { PlatformService } from '../llm-core/platform/service'
import { MessageTransformer } from './message_transform'

export class ChatLunaService extends Service {
    private _plugins: ChatLunaPlugin[] = []
    private _chatInterfaceWrapper: Record<string, ChatInterfaceWrapper> = {}
    private _lock = new ObjectLock()
    private readonly _chain: ChatChain
    private readonly _keysCache: Cache<'chathub/keys', string>
    private readonly _preset: PresetService
    private readonly _platformService: PlatformService
    private readonly _messageTransformer: MessageTransformer

    constructor(
        public readonly ctx: Context,
        public config: Config
    ) {
        super(ctx, 'chatluna')
        this._chain = new ChatChain(ctx, config)
        this._keysCache = new Cache(this.ctx, config, 'chathub/keys')
        this._preset = new PresetService(ctx, config, this._keysCache)
        this._platformService = new PlatformService(ctx)
        this._messageTransformer = new MessageTransformer()

        this._createTempDir()
        this._defineDatabase()
    }

    async registerPlugin(plugin: ChatLunaPlugin) {
        await this._lock.runLocked(async () => {
            this._plugins.push(plugin)
            this.logger.success(`register plugin %c`, plugin.platformName)
        })
    }

    async awaitUninstallPlugin(plugin: ChatLunaPlugin | string) {
        await this._lock.runLocked(async () => {
            const pluginName =
                typeof plugin === 'string' ? plugin : plugin.platformName

            await new Promise((resolve) => {
                const timer = setInterval(() => {
                    const targetPlugin = this._plugins.find(
                        (p) => p.platformName === pluginName
                    )

                    if (!targetPlugin) {
                        clearInterval(timer)
                        resolve(undefined)
                    }
                }, 100)
            })
        })
    }

    awaitLoadPlatform(plugin: ChatLunaPlugin | string) {
        const pluginName =
            typeof plugin === 'string' ? plugin : plugin.platformName

        return new Promise((resolve) => {
            const timer = setInterval(() => {
                const targetModels = this._platformService.getModels(
                    pluginName,
                    ModelType.all
                )

                if (
                    targetModels.length > 0 ||
                    this._platformService.getConfigs(pluginName)?.length > 0
                ) {
                    clearInterval(timer)
                    resolve(undefined)
                }
            }, 100)
        })
    }

    async unregisterPlugin(plugin: ChatLunaPlugin | string) {
        const id = await this._lock.lock()

        const targetPlugin =
            typeof plugin === 'string'
                ? this._plugins.find((p) => p.platformName === plugin)
                : plugin

        if (!targetPlugin) {
            throw new Error(`Plugin ${plugin} not found`)
        }

        const platform = targetPlugin.platformName

        this._chatInterfaceWrapper[platform]?.dispose()

        delete this._chatInterfaceWrapper[platform]

        await targetPlugin.onDispose()

        this._plugins.splice(this._plugins.indexOf(targetPlugin), 1)

        this.logger.success('unregister plugin %c', targetPlugin.platformName)

        await this._lock.unlock(id)
    }

    findPlugin(fun: (plugin: ChatLunaPlugin) => boolean): ChatLunaPlugin {
        return this._plugins.find(fun)
    }

    chat(
        session: Session,
        room: ConversationRoom,
        message: Message,
        event: ChatEvents,
        stream: boolean = false
    ) {
        const { model: modelName } = room

        // provider
        const [platform] = parseRawModelName(modelName)

        const chatInterfaceWrapper =
            this._chatInterfaceWrapper[platform] ??
            this._createChatInterfaceWrapper(platform)

        return chatInterfaceWrapper.chat(session, room, message, event, stream)
    }

    queryInterfaceWrapper(room: ConversationRoom) {
        const { model: modelName } = room

        // provider
        const [platform] = parseRawModelName(modelName)

        return (
            this._chatInterfaceWrapper[platform] ??
            this._createChatInterfaceWrapper(platform)
        )
    }

    async clearChatHistory(room: ConversationRoom) {
        const { model: modelName } = room

        // provider
        const [platformName] = parseRawModelName(modelName)

        const chatBridger =
            this._chatInterfaceWrapper[platformName] ??
            this._createChatInterfaceWrapper(platformName)

        return chatBridger.clearChatHistory(room)
    }

    getCachedInterfaceWrappers() {
        return Object.values(this._chatInterfaceWrapper)
    }

    async clearCache(room: ConversationRoom) {
        const { model: modelName } = room

        // provider
        const [platformName] = parseRawModelName(modelName)

        const chatBridger =
            this._chatInterfaceWrapper[platformName] ??
            this._createChatInterfaceWrapper(platformName)

        return chatBridger.clear(room)
    }

    async createChatModel(platformName: string, model: string) {
        const service = this._platformService

        const client = await service.randomClient(platformName)

        if (client == null) {
            throw new ChatLunaError(
                ChatLunaErrorCode.MODEL_ADAPTER_NOT_FOUND,
                new Error(`The platform ${platformName} no available`)
            )
        }

        return client.createModel(model)
    }

    async createEmbeddings(platformName: string, modelName: string) {
        const service = this._platformService

        const client = await service.randomClient(platformName)

        if (client == null) {
            throw new ChatLunaError(
                ChatLunaErrorCode.MODEL_ADAPTER_NOT_FOUND,
                new Error(`The platform ${platformName} no available`)
            )
        }

        const model = client.createModel(modelName)

        if (model instanceof ChatHubBaseEmbeddings) {
            return model
        }

        throw new ChatLunaError(
            ChatLunaErrorCode.MODEL_NOT_FOUND,
            new Error(`The model ${modelName} is not embeddings`)
        )
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

    protected async stop(): Promise<void> {
        for (const plugin of this._plugins) {
            await plugin.onDispose()
        }
    }

    private _createTempDir() {
        // create dir data/chathub/temp use fs
        // ?
        const tempPath = path.resolve(this.ctx.baseDir, 'data/chathub/temp')
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
                    initial: true
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
                    type: 'char',
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
    }

    private _createChatInterfaceWrapper(
        platform: string
    ): ChatInterfaceWrapper {
        const chatBridger = new ChatInterfaceWrapper(this)
        this.logger.debug(`platform %c`, platform)
        this._chatInterfaceWrapper[platform] = chatBridger
        return chatBridger
    }

    static inject = ['cache', 'database']
}

export class ChatLunaPlugin<
    R extends ClientConfig = ClientConfig,
    T extends ChatLunaPlugin.Config = ChatLunaPlugin.Config
> {
    private _disposables: PromiseLikeDisposable[] = []

    private _supportModels: string[] = []

    private readonly _platformConfigPool: ClientConfigPool<R>

    private _platformService: PlatformService

    constructor(
        protected ctx: Context,
        public readonly config: T,
        public platformName: PlatformClientNames,
        createConfigPool: boolean = true
    ) {
        ctx.once('dispose', async () => {
            await ctx.chatluna.unregisterPlugin(this)
        })

        ctx.runtime.inject.add('cache')

        if (createConfigPool) {
            this._platformConfigPool = new ClientConfigPool<R>(
                ctx,
                config.configMode === 'default'
                    ? ClientConfigPoolMode.AlwaysTheSame
                    : ClientConfigPoolMode.LoadBalancing
            )
        }

        this._platformService = ctx.chatluna.platform
    }

    async parseConfig(f: (config: T) => R[]) {
        const configs = f(this.config)

        for (const config of configs) {
            await this._platformConfigPool.addConfig(config)
        }
    }

    async initClients() {
        this._platformService.registerConfigPool(
            this.platformName,
            this._platformConfigPool
        )

        try {
            await this._platformService.createClients(this.platformName)
        } catch (e) {
            await this.onDispose()
            await this.ctx.chatluna.unregisterPlugin(this)

            throw e
        }

        this._supportModels = this._supportModels.concat(
            this._platformService
                .getModels(this.platformName, ModelType.llm)
                .map((model) => `${this.platformName}/${model.name}`)
        )
    }

    async initClientsWithPool<A extends ClientConfig = R>(
        platformName: PlatformClientNames,
        pool: ClientConfigPool<A>,
        createConfigFunc: (config: T) => A[]
    ) {
        const configs = createConfigFunc(this.config)

        for (const config of configs) {
            await pool.addConfig(config)
        }

        this._platformService.registerConfigPool(platformName, pool)

        try {
            await this._platformService.createClients(platformName)
        } catch (e) {
            await this.onDispose()
            await this.ctx.chatluna.unregisterPlugin(this)

            throw e
        }

        this._supportModels = this._supportModels.concat(
            this._platformService
                .getModels(platformName, ModelType.llm)
                .map((model) => `${platformName}/${model.name}`)
        )
    }

    get supportedModels(): readonly string[] {
        return this._supportModels
    }

    async onDispose(): Promise<void> {
        while (this._disposables.length > 0) {
            const disposable = this._disposables.pop()
            await disposable()
        }
    }

    registerConfigPool(
        platformName: PlatformClientNames,
        configPool: ClientConfigPool
    ) {
        this._platformService.registerConfigPool(platformName, configPool)
    }

    async registerToService() {
        await sleep(200)
        while (this.ctx.chatluna == null) {
            await sleep(500)
        }
        await this.ctx.chatluna.awaitUninstallPlugin(this)
        await this.ctx.chatluna.registerPlugin(this)
    }

    async registerClient(
        func: (
            ctx: Context,
            config: R
        ) => BasePlatformClient<R, ChatHubBaseEmbeddings | ChatLunaChatModel>,
        platformName: string = this.platformName
    ) {
        const disposable = this._platformService.registerClient(
            platformName,
            func
        )

        this._disposables.push(disposable)
    }

    async registerVectorStore(name: string, func: CreateVectorStoreFunction) {
        const disposable = await this._platformService.registerVectorStore(
            name,
            func
        )
        this._disposables.push(disposable)
    }

    async registerTool(name: string, tool: ChatHubTool) {
        const disposable = await this._platformService.registerTool(name, tool)
        this._disposables.push(disposable)
    }

    async registerChatChainProvider(
        name: string,
        description: string,
        func: (
            params: CreateChatHubLLMChainParams
        ) => Promise<ChatHubLLMChainWrapper>
    ) {
        const disposable = await this._platformService.registerChatChain(
            name,
            description,
            func
        )
        this._disposables.push(disposable)
    }
}

type ChatHubChatBridgerInfo = {
    chatInterface: ChatInterface
    presetTemplate: PresetTemplate
    room: ConversationRoom
}

class ChatInterfaceWrapper {
    private _conversations: Record<string, ChatHubChatBridgerInfo> = {}

    private _modelQueue = new RequestIdQueue()
    private _conversationQueue = new RequestIdQueue()
    private _platformService: PlatformService

    constructor(private _service: ChatLunaService) {
        this._platformService = _service.platform
    }

    async chat(
        session: Session,
        room: ConversationRoom,
        message: Message,
        event: ChatEvents,
        stream: boolean
    ): Promise<Message> {
        const { conversationId, model: fullModelName } = room

        const [platform] = parseRawModelName(fullModelName)

        const config = this._platformService.getConfigs(platform)[0]

        const requestId = uuidv4()

        const maxQueueLength = config.value.concurrentMaxSize
        const currentQueueLength =
            await this._modelQueue.getQueueLength(platform)

        await this._conversationQueue.add(conversationId, requestId)
        await this._modelQueue.add(platform, requestId)

        await event['llm-queue-waiting'](currentQueueLength)

        await this._modelQueue.wait(platform, requestId, maxQueueLength)

        try {
            const { chatInterface } =
                this._conversations[conversationId] ??
                (await this._createChatInterface(room))

            const humanMessage = new HumanMessage({
                content: message.content,
                name: message.name,
                additional_kwargs: message.additional_kwargs
            })

            const chainValues = await chatInterface.chat({
                message: humanMessage,
                events: event,
                stream,
                conversationId,
                session
            })

            return {
                content: (chainValues.message as AIMessage).content as string,
                additionalReplyMessages: (
                    chainValues.additionalReplyMessages as string[]
                )?.map((content) => ({
                    content
                }))
            }
        } finally {
            await this._modelQueue.remove(platform, requestId)
            await this._conversationQueue.remove(conversationId, requestId)
        }
    }

    async query(room: ConversationRoom): Promise<ChatInterface> {
        const { conversationId } = room

        const { chatInterface } =
            this._conversations[conversationId] ??
            (await this._createChatInterface(room))

        return chatInterface
    }

    async clearChatHistory(room: ConversationRoom) {
        const { conversationId } = room

        const chatInterface = await this.query(room)

        if (chatInterface == null) {
            return
        }

        const requestId = uuidv4()
        await this._conversationQueue.wait(conversationId, requestId, 0)
        await chatInterface.clearChatHistory()
        delete this._conversations[conversationId]
        await this._conversationQueue.remove(conversationId, requestId)
    }

    async clear(room: ConversationRoom | string) {
        let conversationId: string

        if (typeof room === 'string') {
            conversationId = room
        } else {
            conversationId = room.conversationId
        }

        const requestId = uuidv4()
        await this._conversationQueue.wait(conversationId, requestId, 0)

        delete this._conversations[conversationId]

        await this._conversationQueue.remove(conversationId, requestId)
    }

    getCacheConversations() {
        return Object.keys(this._conversations).map(
            (conversationId) =>
                [conversationId, this._conversations[conversationId]] as [
                    string,
                    ChatHubChatBridgerInfo
                ]
        )
    }

    async delete(room: ConversationRoom) {
        const { conversationId } = room

        const chatInterface = await this.query(room)

        if (chatInterface == null) {
            return
        }

        const requestId = uuidv4()
        await this._conversationQueue.wait(conversationId, requestId, 1)
        await chatInterface.delete(this._service.ctx, room)
        await this._conversationQueue.remove(conversationId, requestId)
        await this.clear(room)
    }

    dispose() {
        this._conversations = {}
    }

    private async _createChatInterface(
        room: ConversationRoom
    ): Promise<ChatHubChatBridgerInfo> {
        const presetTemplate = await this._service.preset.getPreset(room.preset)

        const config = this._service.config

        const chatInterface = new ChatInterface(this._service.ctx.root, {
            chatMode: room.chatMode,
            historyMode: config.historyMode === 'default' ? 'all' : 'summary',
            botName: config.botName,
            systemPrompts: formatPresetTemplate(presetTemplate, {
                name: config.botName,
                date: new Date().toLocaleString()
            }),
            model: room.model,
            longMemory: config.longMemory,
            conversationId: room.conversationId,
            embeddings:
                config.defaultEmbeddings && config.defaultEmbeddings.length > 0
                    ? config.defaultEmbeddings
                    : undefined,
            vectorStoreName:
                config.defaultVectorStore &&
                config.defaultVectorStore.length > 0
                    ? config.defaultVectorStore
                    : undefined,
            maxMessagesCount: config.messageCount
        })

        const result = {
            chatInterface,
            presetTemplate,
            room
        }

        this._conversations[room.conversationId] = result

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
    }

    export const Config: Schema<ChatLunaPlugin.Config> = Schema.object({
        chatConcurrentMaxSize: Schema.number()
            .min(1)
            .max(4)
            .default(1)
            .description('当前适配器适配的模型的最大并发聊天数'),
        chatTimeLimit: Schema.union([Schema.natural(), Schema.any().hidden()])
            .role('computed')
            .default(200)
            .description('每小时的调用限额(次数)'),
        configMode: Schema.union([
            Schema.const('default').description(
                '顺序配置（当配置无效后自动弹出配置切换到下一个可用配置）'
            ),
            Schema.const('balance').description('负载均衡（所有可用配置轮询）')
        ])
            .default('default')
            .description('请求配置模式'),
        maxRetries: Schema.number()
            .description('模型请求失败后的最大重试次数')
            .min(1)
            .max(6)
            .default(3),
        timeout: Schema.number()
            .description('请求超时时间(ms)')
            .default(300 * 1000)
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
    }).description('全局设置') as any

    export const inject = ['cache']
}
