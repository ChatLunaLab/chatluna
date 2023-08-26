import { Service, Context, Schema, Awaitable, Computed } from 'koishi';
import { Config } from '../config';
import { PromiseLikeDisposable } from '../utils/types';
import { ChatInterface } from '../llm-core/chat/app';
import { ConversationRoom, Message } from '../types';
import { AIMessage, HumanMessage } from 'langchain/schema';
import { PresetTemplate, formatPresetTemplate } from '../llm-core/prompt';
import { v4 as uuidv4 } from 'uuid';
import { getPlatformService } from '..';
import { createLogger } from '../utils/logger';
import fs from 'fs';
import path from 'path';
import { defaultFactory } from '../llm-core/chat/default';
import { getPresetInstance } from '..';
import { ObjectLock } from '../utils/lock';
import { CreateChatHubLLMChainParams, CreateToolFunction, CreateVectorStoreRetrieverFunction, ModelType, PlatformClientNames } from '../llm-core/platform/types';
import { ClientConfig, ClientConfigPool, ClientConfigPoolMode } from '../llm-core/platform/config';
import { BasePlatformClient } from '../llm-core/platform/client';
import { ChatHubBaseEmbeddings, ChatHubChatModel } from '../llm-core/platform/model';
import { ChatHubLLMChainWrapper } from '../llm-core/chain/base';
import { ChatEvents } from './types';
import { parseRawModelName } from '../llm-core/utils/count_tokens';
import { ChatHubError, ChatHubErrorCode } from '../utils/error';
import { RequestIdQueue } from '../utils/queue';

const logger = createLogger()

export class ChatHubService extends Service {

    private _plugins: ChatHubPlugin[] = []
    private _chatInterfaceWrapper: Record<string, ChatInterfaceWrapper> = {}
    private _lock = new ObjectLock()

    constructor(public readonly ctx: Context, public config: Config) {
        super(ctx, "chathub")

        // create dir data/chathub/temp use fs
        // ?
        const tempPath = path.resolve(ctx.baseDir, "data/chathub/temp")
        if (!fs.existsSync(tempPath)) {
            fs.mkdirSync(tempPath, { recursive: true })
        }


        this._registerDatabase()

    }

    async registerPlugin(plugin: ChatHubPlugin) {
        await this._lock.lock()
        this._plugins.push(plugin)
        logger.success(`[registerPlugin] ${plugin.platformName}`)
        await this._lock.unlock()
    }

    async unregisterPlugin(plugin: ChatHubPlugin | string) {

        await this._lock.lock()

        const targetPlugin = typeof plugin === "string" ? this._plugins.find(p => p.platformName === plugin) : plugin

        if (!targetPlugin) {
            throw new Error(`Plugin ${plugin} not found`)
        }

        this._plugins.splice(this._plugins.indexOf(targetPlugin), 1)

        const supportedModels = targetPlugin.supportedModels

        for (const model of supportedModels) {
            delete this._chatInterfaceWrapper[model]
        }

        await targetPlugin.onDispose()

        logger.success(`unregisterPlugin: ${targetPlugin.platformName}`)

        await this._lock.unlock()
    }


    findPlugin(fun: (plugin: ChatHubPlugin) => boolean): ChatHubPlugin {
        return this._plugins.find(fun)
    }

    chat(room: ConversationRoom, message: Message, event: ChatEvents, stream: boolean = false) {
        const { model: modelName } = room

        // provider
        const [platform] = parseRawModelName(modelName)

        const chatInterfaceWrapper = this._chatInterfaceWrapper[platform] ?? this._createChatInterfaceWrapper(modelName)

        return chatInterfaceWrapper.chat(room, message, event, stream)
    }

    queryInterfaceWrapper(room: ConversationRoom) {
        const { model: modelName } = room


        // provider
        const [platform] = parseRawModelName(modelName)


        return this._chatInterfaceWrapper[platform] ?? this._createChatInterfaceWrapper(modelName)
    }

    async clearChatHistory(room: ConversationRoom) {
        const { model: modelName } = room

        // provider
        const [platformName] = parseRawModelName(modelName)

        const chatBridger = this._chatInterfaceWrapper[platformName] ?? this._createChatInterfaceWrapper(platformName)

        chatBridger.clear(room)

        return chatBridger.clearChatHistory(room)
    }


    async createChatModel(platformName: string, model: string) {
        const service = getPlatformService()

        const client = await service.randomClient(platformName)

        if (client == null) {
            throw new ChatHubError(ChatHubErrorCode.MODEL_ADAPTER_NOT_FOUND, new Error(`The platform ${platformName} no available`))
        }


        return client.createModel(model)
    }


    protected async stop(): Promise<void> {
        for (const plugin of this._plugins) {
            await plugin.onDispose()
        }
    }

    private _registerDatabase() {

        const ctx = this.ctx

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

    }

    private _createChatInterfaceWrapper(model: string): ChatInterfaceWrapper {
        const chatBridger = new ChatInterfaceWrapper(this)
        this._chatInterfaceWrapper[model] = chatBridger
        return chatBridger
    }

}


export class ChatHubPlugin<R extends ClientConfig = ClientConfig, T extends ChatHubPlugin.Config = ChatHubPlugin.Config> {

    private _disposables: PromiseLikeDisposable[] = []

    private _supportModels: string[] = []

    private _platformConfigPool: ClientConfigPool<R>

    private _platformService = getPlatformService()

    constructor(protected ctx: Context, public readonly config: T, public platformName: PlatformClientNames, createConfigPool: Boolean = true) {
        ctx.on("dispose", async () => {
            await ctx.chathub.unregisterPlugin(this)
        })
        if (createConfigPool) {
            this._platformConfigPool = new ClientConfigPool<R>(ctx, config.configMode === "default" ? ClientConfigPoolMode.AlwaysTheSame : ClientConfigPoolMode.LoadBalancing)
        }
    }

    async parseConfig(f: (config: T) => R[]) {
        const configs = f(this.config)

        for (const config of configs) {
            await this._platformConfigPool.addConfig(config)
        }
    }

    async initClients() {
        this._platformService.registerConfigPool(this.platformName, this._platformConfigPool)

        try {
            await this._platformService.createClients(this.platformName)
        } catch (e) {
            await this.onDispose()
            await this.ctx.chathub.unregisterPlugin(this)

            throw e
        }

        this._supportModels = this._supportModels.concat(this._platformService.getModels(this.platformName, ModelType.llm).map(model => `${this.platformName}/${model.name}`))
    }


    async initClientsWithPool<A extends ClientConfig = R>(platformName: PlatformClientNames, pool: ClientConfigPool<A>, f: (config: T) => A[]) {
        const configs = f(this.config)

        for (const config of configs) {
            await pool.addConfig(config)
        }

        this._platformService.registerConfigPool(platformName, pool)

        try {
            await this._platformService.createClients(platformName)
        } catch (e) {
            await this.onDispose()
            await this.ctx.chathub.unregisterPlugin(this)

            throw e
        }

        this._supportModels = this._supportModels.concat(this._platformService.getModels(platformName, ModelType.llm).map(model => `${platformName}/${model.name}`))
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

    registerConfigPool(platformName: PlatformClientNames, configPool: ClientConfigPool) {
        this._platformService.registerConfigPool(platformName, configPool)
    }

    async registerToService() {
        await this.ctx.chathub.registerPlugin(this)
    }

    async registerClient(func: (ctx: Context, config: ClientConfig) => BasePlatformClient<R, ChatHubBaseEmbeddings | ChatHubChatModel>, platformName: string = this.platformName) {

        const disposable = this._platformService.registerClient(platformName, func)

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

    async registerChatChainProvider(name: string, description: string, func: (params: CreateChatHubLLMChainParams) => Promise<ChatHubLLMChainWrapper>) {
        const disposable = await this._platformService.registerChatChain(name, description, func)
        this._disposables.push(disposable)
    }
}

type ChatHubChatBridgerInfo = {
    chatInterface: ChatInterface,
    presetTemplate: PresetTemplate
}

class ChatInterfaceWrapper {

    private _conversations: Record<string, ChatHubChatBridgerInfo> = {}

    private _modelQueue = new RequestIdQueue()
    private _conversationQueue = new RequestIdQueue()
    private _platformService = getPlatformService()

    constructor(private _service: ChatHubService) { }

    async chat(room: ConversationRoom, message: Message, event: ChatEvents, stream: boolean): Promise<Message> {
        const { conversationId, model: fullModelName } = room

        const [platform, modelName] = parseRawModelName(fullModelName)

        const config = this._platformService.getConfigs(platform)[0]


        const requestId = uuidv4()

        const maxQueueLength = config.value.concurrentMaxSize
        const currentQueueLength = this._modelQueue.getQueueLength(platform)

        logger.debug(`[chat] maxQueueLength: ${maxQueueLength}, currentQueueLength: ${currentQueueLength}`)

        this._conversationQueue.add(conversationId, requestId)

        if (currentQueueLength >= maxQueueLength) {
            await event['llm-queue-waiting'](currentQueueLength)
        }
        await this._modelQueue.wait(modelName, requestId, maxQueueLength)

        try {

            const { chatInterface } = this._conversations[conversationId] ?? await this._createChatInterface(room)

            const humanMessage = new HumanMessage(message.content)

            humanMessage.name = message.name

            const chainValues = await chatInterface.chat(
                humanMessage, event, stream)

            return {
                content: (chainValues.message as AIMessage).content,
                additionalReplyMessages: (chainValues.additionalReplyMessages as string[])?.map(content => ({
                    content,
                })),
            }
        } catch (e) {
            throw e
        } finally {
            this._modelQueue.remove(modelName, requestId)
            this._conversationQueue.remove(conversationId, requestId)
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
        await this._conversationQueue.wait(conversationId, requestId, 0)
        await chatInterface.clearChatHistory()
        delete this._conversations[conversationId]
        this._conversationQueue.remove(conversationId, requestId)
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
        await this._conversationQueue.wait(conversationId, requestId, 0)
        await chatInterface.delete(this._service.ctx, room)
        this.clear(room)
        this._conversationQueue.remove(conversationId, requestId)
    }

    async dispose() {
        this._conversations = {}
    }

    private async _createChatInterface(room: ConversationRoom): Promise<ChatHubChatBridgerInfo> {

        const presetTemplate = await getPresetInstance().getPreset(room.preset)

        const config = this._service.config

        const chatInterface = new ChatInterface(this._service.ctx, {
            chatMode: room.chatMode as any,
            historyMode: config.historyMode === "default" ? "all" : "summary",
            botName: config.botName,
            systemPrompts: formatPresetTemplate(presetTemplate, {
                name: config.botName,
                date: new Date().toLocaleString(),
            }),
            model: room.model,
            longMemory: config.longMemory,
            conversationId: room.conversationId,
            embeddings: config.defaultEmbeddings && config.defaultEmbeddings.length > 0 ? config.defaultEmbeddings : undefined,
            vectorStoreName: config.defaultVectorStore && config.defaultVectorStore.length > 0 ? config.defaultVectorStore : undefined,
        })

        const result = {
            chatInterface,
            presetTemplate,
        }

        this._conversations[room.conversationId] = result

        return result
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
