import { Service, Context, Schema, Awaitable, Computed, Disposable, Logger } from 'koishi';
import { Config } from '../config';
import { Factory } from '../llm-core/chat/factory';
import { BaseProvider, ChatChainProvider, EmbeddingsProvider, ModelProvider, ToolProvider, VectorStoreRetrieverProvider } from '../llm-core/model/base';
import { PromiseLikeDisposeable } from '../llm-core/utils/types';
import { ChatInterface } from '../llm-core/chat/app';
import { ConversationRoom, ConversationRoomGroupInfo, ConversationRoomMemberInfo, ConversationRoomUserInfo, Message } from '../types';
import { AIMessage, BaseChatMessageHistory, HumanMessage } from 'langchain/schema';
import { PresetTemplate, formatPresetTemplate, loadPreset } from '../llm-core/prompt';
import { KoishiDataBaseChatMessageHistory } from "../llm-core/memory/message/database_memory"
import { v4 as uuidv4 } from 'uuid';
import { getKeysCache } from '..';
import { createLogger } from '../llm-core/utils/logger';
import fs from 'fs';
import path from 'path';
import { defaultFactory } from '../llm-core/chat/default';
import { config } from 'process';
import { getPresetInstance } from '..';


const logger = createLogger("@dingyi222666/chathub/services/chat")

export class ChatHubService extends Service {

    private _plugins: ChatHubPlugin<ChatHubPlugin.Config>[] = []
    private _chatBridgers: Record<string, ChatHubChatBridger> = {}
    private _lock = false

    constructor(public readonly ctx: Context, public config: Config) {
        super(ctx, "chathub")

        // create dir data/chathub/temp use fs
        // ?
        const tempPath = path.resolve(ctx.baseDir, "data/chathub/temp")
        if (!fs.existsSync(tempPath)) {
            fs.mkdirSync(tempPath, { recursive: true })
        }

        ctx.database.extend('chathub_conversaion', {
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
                type: 'char',
                length: 255,
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
                type: 'char',
                length: 255,
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

        ctx.database.extend('chathub_room_group_meber', {
            groupId: {
                type: 'char',
                length: 255,
            },
            roomId: {
                type: 'char',
                length: 255,
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
                type: 'char',
                length: 255,
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

    async registerPlugin<T extends ChatHubPlugin.Config>(plugin: ChatHubPlugin<T>) {
        await this._getAndLock()
        this._plugins.push(plugin)
        await this._releaseLock()
    }

    async unregisterPlugin(plugin: ChatHubPlugin<ChatHubPlugin.Config> | string) {

        await this._getAndLock()

        const targetPlugin = typeof plugin === "string" ? this._plugins.find(p => p.name === plugin) : plugin

        if (!targetPlugin) {
            throw new Error(`Plugin ${plugin} not found`)
        }

        this._plugins = this._plugins.filter(p => p !== targetPlugin)

        const supportedModels = targetPlugin.supportedModels

        for (const model of supportedModels) {
            delete this._chatBridgers[model]
        }

        await targetPlugin.onDispose()

        await this._releaseLock()
    }



    findPlugin(fun: (plugin: ChatHubPlugin<ChatHubPlugin.Config>) => boolean): ChatHubPlugin<ChatHubPlugin.Config> {
        return this._plugins.find(fun)
    }

    chat(room: ConversationRoom, message: Message) {
        const { model: fullModelName } = room

        if (fullModelName == null) {
            throw new Error(`找不到模型 ${fullModelName}`)
        }

        // provider
        const [model] = fullModelName.split(/(?<=^[^\/]+)\//)

        const chatBridger = this._chatBridgers[model] ?? this._createChatBridger(model)

        return chatBridger.chat(room, message)
    }

    queryBridger(room: ConversationRoom) {
        const { model: fullModelName } = room

        if (fullModelName == null) {
            throw new Error(`找不到模型 ${fullModelName}`)
        }

        // provider
        const [model] = fullModelName.split(/(?<=^[^\/]+)\//)


        return this._chatBridgers[model] ?? this._createChatBridger(model)
    }

    clearInterface(room: ConversationRoom) {
        const { model: fullModelName } = room

        if (fullModelName == null) {
            throw new Error(`找不到模型 ${fullModelName}`)
        }

        // provider
        const [model] = fullModelName.split(/(?<=^[^\/]+)\//)

        const chatBridger = this._chatBridgers[model]

        if (chatBridger == null) {
            return
        }

        return chatBridger.clear(room)
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

    private async _getLock() {
        while (this._lock) {
            await new Promise(resolve => setTimeout(resolve, 100))
        }
    }

    private async _releaseLock() {
        this._lock = false
    }

    private async _getAndLock() {
        await this._getLock()
        this._lock = true
    }


    private _createChatBridger(model: string): ChatHubChatBridger {
        const chatBridger = new ChatHubChatBridger(this)
        this._chatBridgers[model] = chatBridger
        return chatBridger
    }

}


export abstract class ChatHubPlugin<T extends ChatHubPlugin.Config> {

    private _disposables: PromiseLikeDisposeable[] = []

    private _providers: BaseProvider[] = []

    private _supportModels: string[] = []

    abstract readonly name: string

    protected constructor(protected ctx: Context, public readonly config: T) {
        ctx.on("dispose", async () => {
            await ctx.chathub.unregisterPlugin(this)
        })
    }

    get providers(): ReadonlyArray<BaseProvider> {
        return this._providers
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

    registerModelProvider(provider: ModelProvider) {
        const disposable = Factory.registerModelProvider(provider)
        this._providers.push(provider)
        this._disposables.push(disposable)

        setTimeout(async () => {
            this._supportModels.push(...(await provider.listModels()))
        }, 0)
    }

    registerEmbeddingsProvider(provider: EmbeddingsProvider) {
        const disposable = Factory.registerEmbeddingsProvider(provider)
        this._providers.push(provider)
        this._disposables.push(disposable)
    }

    registerVectorStoreRetrieverProvider(provider: VectorStoreRetrieverProvider) {
        const disposable = Factory.registerVectorStoreRetrieverProvider(provider)
        this._providers.push(provider)
        this._disposables.push(disposable)
    }

    registerToolProvider(tool: ToolProvider) {
        const disposable = Factory.registerToolProvider(tool.name, tool)
        this._disposables.push(disposable)
    }

    registerChatChainProvider(provider: ChatChainProvider) {
        const disposable = Factory.registerChatChainProvider(provider)
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

        const splited = model.split(/(?<=^[^\/]+)\//)
        const modelProviders = await Factory.selectModelProviders(async (name, provider) => {
            return (await provider.listModels()).includes(splited[1]) && name === splited[0]
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
        maxRetries: number,
    }

    export const Config: Schema<ChatHubPlugin.Config> = Schema.object({
        chatConcurrentMaxSize: Schema.number().min(1).max(4).default(1).description('当前适配器适配的模型的最大并发聊天数'),
        chatTimeLimit: Schema.union([
            Schema.natural(),
            Schema.any().hidden(),
        ]).role('computed').default(20).description('每小时的调用限额(次数)'),
        maxRetries: Schema.number().description("模型请求失败后的最大重试次数").min(1).max(6).default(3),
        timeout: Schema.number().description("请求超时时间(ms)").default(200 * 1000),
    }).description('全局设置')

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
        chathub_room_group_meber: ConversationRoomGroupInfo
        chathub_user: ConversationRoomUserInfo
    }
}