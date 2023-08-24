import { Service, Context, Schema, Awaitable, Computed, Session, Disposable, Logger } from 'koishi';
import { Config } from '../config';
import { Factory } from '../llm-core/chat/factory';
import { BaseProvider, ChatChainProvider, EmbeddingsProvider, ModelProvider, ToolProvider, VectorStoreRetrieverProvider } from '../llm-core/model/base';
import { PromiseLikeDisposable } from '../llm-core/utils/types';
import { ChatInterface } from '../llm-core/chat/app';
import { ConversationRoom, ConversationRoomGroupInfo, ConversationRoomMemberInfo, ConversationRoomUserInfo, Message } from '../types';
import { AIMessage, BaseChatMessageHistory, HumanMessage } from 'langchain/schema';
import { PresetTemplate, formatPresetTemplate, loadPreset } from '../llm-core/prompt';
import { KoishiDataBaseChatMessageHistory } from "../llm-core/memory/message/database_memory"
import { v4 as uuidv4 } from 'uuid';
import { getKeysCache, getPlatformService } from '..';
import { createLogger } from '../llm-core/utils/logger';
import fs from 'fs';
import path from 'path';
import { defaultFactory } from '../llm-core/chat/default';
import { config } from 'process';
import { getPresetInstance } from '..';
import { ObjectLock } from '../utils/lock';
import { CreateChatHubLLMChainParams, CreateToolFunction, CreateVectorStoreRetrieverFunction, ModelType, PlatformClientNames } from '../llm-core/platform/types';
import { ClientConfig, ClientConfigPool, ClientConfigPoolMode } from '../llm-core/platform/config';
import { BasePlatformClient } from '../llm-core/platform/client';
import { ChatHubChatModel } from '../llm-core/platform/model';
import { ChatHubLLMChain } from '../llm-core/chain/base';

const logger = createLogger("@dingyi222666/chathub/services/chat")

export class ChatHubService extends Service {

    private _plugins: ChatHubPlugin[] = []
    private _chatBridges: Record<string, ChatHubChatBridger> = {}
    private _lock = new ObjectLock()

    constructor(public readonly ctx: Context, public config: Config) {
        super(ctx, "chathub")

        // create dir data/chathub/temp use fs
        // ?
        const tempPath = path.resolve(ctx.baseDir, "data/chathub/temp")
        if (!fs.existsSync(tempPath)) {
            fs.mkdirSync(tempPath, { recursive: true })
        }

        ctx.database.extend('chathub_conversation', {
            id: {
                type: 'char',
                length: 255,
            },
            extraParams: {
                type: 'json',
                nullable: true
            },
            latestId: {
                type: 'char',
                length: 255,
                nullable: true
            },
        }, {
            autoInc: false,
            primary: 'id',
            unique: ['id']
        })

        ctx.database.extend('chathub_message', {
            id: {
                type: 'char',
                length: 255,
            },
            text: "text",
            parent: {
                type: 'char',
                length: 255,
                nullable: true
            },
            role: {
                type: 'char',
                length: 20,
            },
            conversation: {
                type: 'char',
                length: 255,
            },
            additional_kwargs: {
                type: "string",
                nullable: true
            }
        }, {
            autoInc: false,
            primary: 'id',
            unique: ['id'],
            /*  foreign: {
                 conversation: ['chathub_conversaion', 'id']
             } */
        })


        ctx.database.extend('chathub_room', {
            roomId: {
                type: "integer",
            },
            roomName: "string",
            conversationId: {
                type: 'char',
                length: 255,
                nullable: true
            },

            roomMasterId: {
                type: 'char',
                length: 255,
            },
            visibility: {
                type: 'char',
                length: 20,
            },
            preset: {
                type: 'char',
                length: 255,
            },
            model: {
                type: 'char',
                length: 100,
            },
            chatMode: {
                type: 'char',
                length: 20,
            },
            password: {
                type: 'char',
                length: 100,
            }
        }, {
            autoInc: false,
            primary: 'roomId',
            unique: ['roomId']
        })

        ctx.database.extend('chathub_room_member', {
            userId: {
                type: 'char',
                length: 255,
            },
            roomId: {
                type: 'integer'
            },
            roomPermission: {
                type: 'char',
                length: 50,
            },
            mute: {
                type: 'boolean',
                initial: false
            }
        }, {
            autoInc: false,
            primary: ['userId', 'roomId']
        })

        ctx.database.extend('chathub_room_group_member', {
            groupId: {
                type: 'char',
                length: 255,
            },
            roomId: {
                type: 'integer'
            },
            roomVisibility: {
                type: 'char',
                length: 20,
            },
        }, {
            autoInc: false,
            primary: ['groupId', 'roomId'],

        })


        ctx.database.extend('chathub_user', {
            userId: {
                type: 'char',
                length: 255,
            },
            defaultRoomId: {
                type: 'integer'
            },
            groupId: {
                type: 'char',
                length: 255,
                nullable: true
            }
        }, {
            autoInc: false,
            primary: ['userId', 'groupId']
        })

        setTimeout(async () => {
            await defaultFactory(ctx)
        }, 0)

    }

    async registerPlugin(plugin: ChatHubPlugin) {
        await this._lock.lock()
        this._plugins.push(plugin)
        await this._lock.unlock()
    }

    async unregisterPlugin(plugin: ChatHubPlugin | string) {

        await this._lock.lock()

        const targetPlugin = typeof plugin === "string" ? this._plugins.find(p => p.platfromName === plugin) : plugin

        if (!targetPlugin) {
            throw new Error(`Plugin ${plugin} not found`)
        }

        this._plugins = this._plugins.filter(p => p !== targetPlugin)

        const supportedModels = targetPlugin.supportedModels

        for (const model of supportedModels) {
            delete this._chatBridges[model]
        }

        await targetPlugin.onDispose()

        await this._lock.unlock()
    }


    findPlugin(fun: (plugin: ChatHubPlugin) => boolean): ChatHubPlugin {
        return this._plugins.find(fun)
    }

    chat(room: ConversationRoom, message: Message) {
        const { model: fullModelName } = room

        if (fullModelName == null) {
            throw new Error(`找不到模型 ${fullModelName}`)
        }

        // provider
        const [model] = fullModelName.split(/(?<=^[^\/]+)\//)

        const chatBridger = this._chatBridges[model] ?? this._createChatBridger(model)

        return chatBridger.chat(room, message)
    }

    queryBridger(room: ConversationRoom) {
        const { model: fullModelName } = room

        if (fullModelName == null) {
            throw new Error(`找不到模型 ${fullModelName}`)
        }

        // provider
        const [model] = fullModelName.split(/(?<=^[^\/]+)\//)


        return this._chatBridges[model] ?? this._createChatBridger(model)
    }

    async clearInterface(room: ConversationRoom) {
        const { model: fullModelName } = room

        if (fullModelName == null) {
            throw new Error(`找不到模型 ${fullModelName}`)
        }

        // provider
        const [model] = fullModelName.split(/(?<=^[^\/]+)\//)

        const chatBridger = this._chatBridges[model] ?? this._createChatBridger(model)

        chatBridger.clear(room)

        return chatBridger.clearChatHistory(room)
    }


    async createChatModel(providerName: string, model: string, params?: Record<string, any>) {
        const modelProviders = await Factory.selectModelProviders(async (name, provider) => {
            return (await provider.listModels()).includes(model) && name === providerName
        })

        if (modelProviders.length === 0) {
            throw new Error(`找不到模型 ${model}`)
        } else if (modelProviders.length > 1) {
            throw new Error(`找到多个模型 ${model}`)
        }

        const modelProvider = modelProviders[0]

        return await modelProvider.createModel(model, params ?? {})
    }


    protected async stop(): Promise<void> {
        for (const plugin of this._plugins) {
            await plugin.onDispose()
        }
    }


    private _createChatBridger(model: string): ChatHubChatBridger {
        const chatBridger = new ChatHubChatBridger(this)
        this._chatBridges[model] = chatBridger
        return chatBridger
    }

}


export class ChatHubPlugin<R extends ClientConfig = ClientConfig, T extends ChatHubPlugin.Config = ChatHubPlugin.Config> {

    private _disposables: PromiseLikeDisposable[] = []

    private _supportModels: string[] = []

    private _platformConfigPool: ClientConfigPool<R>

    private _platformService = getPlatformService()

    protected constructor(protected ctx: Context, public readonly config: T, public platformName: PlatformClientNames) {
        ctx.on("dispose", async () => {
            await ctx.chathub.unregisterPlugin(this)
        })
        this._platformConfigPool = new ClientConfigPool<R>(ctx, config.configMode === "default" ? ClientConfigPoolMode.AlwaysTheSame : ClientConfigPoolMode.LoadBalancing)

        this._platformService.registerConfigPool(this.platformName, this._platformConfigPool)

    }

    async parseConfig(f: (config: T) => R[]) {
        const configs = f(this.config)

        for (const config of configs) {
            await this._platformConfigPool.addConfig(config)
        }
    }

    async initClients() {
        await this._platformService.createClients(this.platformName)

        this._supportModels = this._supportModels.concat(this._platformService.getModels(this.platformName, ModelType.llm).map(model => `${this.platformName}/${model.name}`))
    }


    get supportedModels(): ReadonlyArray<string> {
        return this._supportModels
    }

    async onDispose(): Promise<void> {
        while (this._disposables.length > 0) {
            const disposable = this._disposables.pop()
            await disposable()
        }
    }

    async registerToService() {
        await this.ctx.chathub.registerPlugin(this)
    }

    async registerClient(func: (ctx: Context, config: ClientConfig) => BasePlatformClient<R, ChatHubChatModel>) {

        const disposable = this._platformService.registerClient(this.platformName, func)

        this._disposables.push(disposable)
    }


    async registerVectorStoreRetriever(name: string, func: CreateVectorStoreRetrieverFunction) {
        const disposable = await this._platformService.registerVectorStoreRetriever(name, func)
        this._disposables.push(disposable)
    }

    registerTool(name: string, func: CreateToolFunction) {
        const disposable = this._platformService.registerTool(name, func)
        this._disposables.push(disposable)
    }

    async registerChatChainProvider(name: string, description: string, func: (params: CreateChatHubLLMChainParams) => Promise<ChatHubLLMChain>) {
        const disposable = await this._platformService.registerChatChain(name, description, func)
        this._disposables.push(disposable)
    }
}

type ChatHubChatBridgerInfo = {
    chatInterface: ChatInterface,
    presetTemplate: PresetTemplate
}

class ChatHubChatBridger {

    private _conversations: Record<string, ChatHubChatBridgerInfo> = {}

    private _modelQueue: Record<string, string[]> = {}
    private _conversationQueue: Record<string, string[]> = {}

    constructor(private _service: ChatHubService) { }

    async chat(room: ConversationRoom, message: Message): Promise<Message> {
        const { conversationId, model } = room

        const splitted = model.split(/(?<=^[^\/]+)\//)
        const modelProviders = await Factory.selectModelProviders(async (name, provider) => {
            return (await provider.listModels()).includes(splitted[1]) && name === splitted[0]
        })

        if (modelProviders.length === 0) {
            throw new Error(`找不到模型 ${room.model}`)
        } else if (modelProviders.length > 1) {
            throw new Error(`找到多个模型 ${room.model}`)
        }

        const modelProvider = modelProviders[0]

        const requestId = uuidv4()

        const maxQueueLength = modelProvider.getExtraInfo()?.chatConcurrentMaxSize ?? 0

        logger.debug(`[chat] maxQueueLength: ${maxQueueLength}, currentQueueLength: ${this._conversationQueue?.[conversationId]?.length ?? 0}`)

        this._addToConversationQueue(conversationId, requestId)
        await this._waitModelQueue(model, requestId, maxQueueLength)

        try {

            const { chatInterface } = this._conversations[conversationId] ?? await this._createChatInterface(room)

            const humanMessage = new HumanMessage(message.content)

            humanMessage.name = message.name

            const chainValues = await chatInterface.chat(
                humanMessage)

            return {
                content: (chainValues.message as AIMessage).content,
                additionalReplyMessages: (chainValues.additionalReplyMessages as string[])?.map(content => ({
                    content,
                })),
            }
        } catch (e) {
            throw e
        } finally {
            await this._releaseModelQueue(model, requestId)
            this._releaseConversationQueue(conversationId, requestId)
        }
    }

    async query(room: ConversationRoom): Promise<ChatInterface> {
        const { conversationId } = room

        const { chatInterface } = this._conversations[conversationId] ?? await this._createChatInterface(room)

        return chatInterface
    }

    async clearChatHistory(room: ConversationRoom) {
        const { conversationId } = room

        const chatInterface = await this.query(room)

        if (chatInterface == null) {
            return
        }

        const requestId = uuidv4()
        await this._waitConversationQueue(conversationId, requestId, 0)
        await chatInterface.clearChatHistory()
        delete this._conversations[conversationId]
        this._releaseConversationQueue(conversationId, requestId)
    }

    clear(room: ConversationRoom) {
        const { conversationId } = room
        delete this._conversations[conversationId]
    }


    async delete(room: ConversationRoom) {
        const { conversationId } = room

        const chatInterface = await this.query(room)

        if (chatInterface == null) {
            return
        }

        const requestId = uuidv4()
        await this._waitConversationQueue(conversationId, requestId, 0)
        await chatInterface.delete(this._service.ctx, room)
        this.clear(room)
        this._releaseConversationQueue(conversationId, requestId)
    }

    async dispose() {
        this._conversations = {}
    }

    private async _createChatInterface(room: ConversationRoom): Promise<ChatHubChatBridgerInfo> {

        const presetTemplate = await getPresetInstance().getPreset(room.preset)

        const config = this._service.config

        const chatInterface = new ChatInterface({
            chatMode: room.chatMode as any,
            historyMode: config.historyMode === "default" ? "all" : "summary",
            botName: config.botName,
            chatHistory: await this._createChatHistory(room),
            systemPrompts: formatPresetTemplate(presetTemplate, {
                name: config.botName,
                date: new Date().toLocaleString(),
            }),
            mixedModelName: room.model,
            createParams: {
                longMemory: config.longMemory,
                mixedSenderId: room.conversationId
            },
            mixedEmbeddingsName: config.defaultEmbeddings && config.defaultEmbeddings.length > 0 ? config.defaultEmbeddings : undefined,
            mixedVectorStoreName: config.defaultVectorStore && config.defaultVectorStore.length > 0 ? config.defaultVectorStore : undefined,
        })

        const createResult = await chatInterface.init()

        if (!createResult) {
            throw Error("创建模型失败！请检查你的 logger 和 错误日志")
        }

        const result = {
            chatInterface,
            presetTemplate,
        }

        this._conversations[room.conversationId] = result

        return result
    }


    private _addToConversationQueue(conversationId: string, requestId: string) {
        if (this._conversationQueue[conversationId] == null) {
            this._conversationQueue[conversationId] = []
        }

        this._conversationQueue[conversationId].push(requestId)
    }

    private _releaseConversationQueue(conversationId: string, requestId: string) {
        if (this._conversationQueue[conversationId] == null) {
            this._conversationQueue[conversationId] = []
        }

        const queue = this._conversationQueue[conversationId]

        const index = queue.indexOf(requestId)

        if (index !== -1) {
            queue.splice(index, 1)
        }
    }

    private async _waitConversationQueue(conversationId: string, requestId: string, maxQueueLength: number) {

        if (this._conversationQueue[conversationId] == null) {
            this._conversationQueue[conversationId] = []
        }

        const queue = this._conversationQueue[conversationId]

        queue.push(requestId)

        while (queue.length > maxQueueLength) {
            if (queue[0] === requestId) {
                break
            }

            await new Promise(resolve => setTimeout(resolve, 1000))
        }
    }

    private async _waitModelQueue(model: string, requestId: string, maxQueueLength: number) {

        if (this._modelQueue[model] == null) {
            this._modelQueue[model] = []
        }

        const queue = this._modelQueue[model]
        queue.push(requestId)

        while (queue.length > maxQueueLength) {
            if (queue[0] === requestId) {
                break
            }

            await new Promise(resolve => setTimeout(resolve, 1000))
        }
    }

    private async _releaseModelQueue(model: string, requestId: string) {
        if (this._modelQueue[model] == null) {
            this._modelQueue[model] = []
        }

        const queue = this._modelQueue[model]

        const index = queue.indexOf(requestId)

        if (index !== -1) {
            queue.splice(index, 1)
        }

    }

    private async _createChatHistory(room: ConversationRoom): Promise<BaseChatMessageHistory> {
        const chatMessageHistory = new KoishiDataBaseChatMessageHistory(
            this._service.ctx, room.conversationId
        )

        await chatMessageHistory.loadConversation()

        return chatMessageHistory
    }

    private _parsePresetTemplate(systemPrompts: string): PresetTemplate {
        return loadPreset(systemPrompts)
    }
}


export namespace ChatHubPlugin {

    export interface Config {
        chatConcurrentMaxSize?: number,
        chatTimeLimit?: Computed<Awaitable<number>>,
        timeout?: number,
        configMode: string,
        maxRetries: number,
    }

    export const Config: Schema<ChatHubPlugin.Config> = Schema.object({
        chatConcurrentMaxSize: Schema.number().min(1).max(4).default(1).description('当前适配器适配的模型的最大并发聊天数'),
        chatTimeLimit: Schema.union([
            Schema.natural(),
            Schema.any().hidden(),
        ]).role('computed').default(20).description('每小时的调用限额(次数)'),
        configMode: Schema.union([
            Schema.const("default").description("默认从上自下配置（当配置无效后自动弹出配置切换到下一个可用配置）"),
            Schema.const("balance").description("负载均衡（所有可用配置轮询）"),
        ]).default("default").description("请求配置模式"),
        maxRetries: Schema.number().description("模型请求失败后的最大重试次数").min(1).max(6).default(3),
        timeout: Schema.number().description("请求超时时间(ms)").default(200 * 1000),
    }).description('全局设置') as any

    export const using = ['cache']
}


declare module 'koishi' {
    export interface Context {
        chathub: ChatHubService
    }
}

declare module 'koishi' {
    interface Tables {
        chathub_room: ConversationRoom
        chathub_room_member: ConversationRoomMemberInfo
        chathub_room_group_member: ConversationRoomGroupInfo
        chathub_user: ConversationRoomUserInfo
    }
    interface Events {
        'chathub/before-check-sender'(session: Session): Promise<boolean>
    }

}