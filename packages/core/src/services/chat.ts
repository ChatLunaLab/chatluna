import { Service, Context, Schema, Awaitable, Computed, Disposable } from 'koishi';
import { Config } from '../config';
import { Factory } from '@dingyi222666/chathub-llm-core/lib/chat/factory';
import { BaseProvider, EmbeddingsProvider, ModelProvider, ToolProvider, VectorStoreRetrieverProvider } from '@dingyi222666/chathub-llm-core/lib/model/base';
import { PromiseLikeDisposeable } from '@dingyi222666/chathub-llm-core/lib/utils/types';
import { ChatInterface } from '@dingyi222666/chathub-llm-core/lib/chat/app';
import { ConversationInfo, Message } from '../types';
import { AIChatMessage, BaseChatMessageHistory, HumanChatMessage } from 'langchain/schema';
import { PresetTemplate, formatPresetTemplate, loadPreset } from '@dingyi222666/chathub-llm-core';
import { KoishiDatabaseChatMessageHistory } from "@dingyi222666/chathub-llm-core/lib/memory/message/database_memory"
import { v4 as uuidv4 } from 'uuid';

export class ChatHubService extends Service {

    private _plugins: ChatHubPlugin<ChatHubPlugin.Config>[] = []
    private _chatBridgers: Record<string, ChatHubChatBridger> = {}
    private _lock = false

    constructor(public readonly ctx: Context, public config: Config) {
        super(ctx, "chathub")

        ctx.database.extend("chathub_conversation_info", {
            chatMode: {
                type: "char",
                length: 20,
            },
            conversationId: {
                type: "char",
                length: 256,
            },
            senderId: {
                type: "char",
                length: 256,
            },
            systemPrompts: {
                type: "text",
            },
            model: {
                type: "char",
                length: 50,
            }
        }, {
            primary: "conversationId",
            unique: ["conversationId"],
            autoInc: false,
            foreign: {
                conversationId: ['chathub_conversaion', 'id']
            }
        })
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

    async chat(conversationInfo: ConversationInfo, message: Message) {
        const { model } = conversationInfo

        const chatBridger = this._chatBridgers[model] ?? this._createChatBridger(model)

        return await chatBridger.chat(conversationInfo, message)
    }

    async queryBridger(conversationInfo: ConversationInfo) {
        const { model } = conversationInfo

        const chatBridger = this._chatBridgers[model] ?? this._createChatBridger(model)

        return chatBridger
    }

    async clearInterface(conversationInfo: ConversationInfo) {
        const { model } = conversationInfo

        const chatBridger = this._chatBridgers[model]

        if (chatBridger == null) {
            return
        }

        return await chatBridger.clear(conversationInfo)
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
            await new Promise<void>((resolve, reject) => {
                setTimeout(() => {
                    resolve()
                }, 1000)
            })
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

    registerToolProvider(name: string, tool: ToolProvider) {
        const disposable = Factory.registerToolProvider(name, tool)
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

    async chat(conversationInfo: ConversationInfo, message: Message): Promise<Message> {
        const { conversationId, model } = conversationInfo

        const splited = model.split("/")
        const modelProviders = await Factory.selectModelProviders(async (name, provider) => {
            return (await provider.listModels()).includes(splited[1]) && name === splited[0]
        })

        if (modelProviders.length === 0) {
            throw new Error(`找不到模型 ${conversationInfo.model}`)
        } else if (modelProviders.length > 1) {
            throw new Error(`找到多个模型 ${conversationInfo.model}`)
        }

        const modelProvider = modelProviders[0]

        const requestId = uuidv4()

        const maxQueueLength = modelProvider.getExtraInfo()?.chatConcurrentMaxSize ?? 1

        if (maxQueueLength < 1) {
            console.error(`maxQueueLength < 1, model: ${model}, maxQueueLength: ${maxQueueLength}`)
        }

        this.addToConversationQueue(conversationId, requestId)
        await this.waitModelQueue(model, requestId, maxQueueLength)

        const { chatInterface } = this._conversations[conversationId] ?? await this._createChatInterface(conversationInfo)

        const humanChatMessage = new HumanChatMessage(message.text)

        humanChatMessage.name = message.name

        try {

            const chainValues = await chatInterface.chat(
                humanChatMessage)

            return {
                text: (chainValues.message as AIChatMessage).text,
                additionalReplyMessages: (chainValues.additionalReplyMessages as string[])?.map(text => ({
                    text,
                })),
            }
        } catch (e) {
            throw e
        } finally {
            this.removeFromConversationQueue(conversationId, requestId)
        }
    }

    async query(conversationInfo: ConversationInfo): Promise<ChatInterface> {
        const { conversationId } = conversationInfo

        const { chatInterface } = this._conversations[conversationId] ?? await this._createChatInterface(conversationInfo)

        return chatInterface
    }

    async clearChatHistory(conversationInfo: ConversationInfo) {
        const { conversationId } = conversationInfo

        const { chatInterface } = this._conversations[conversationId] ?? {}

        if (chatInterface == null) {
            return
        }

        await this.waitConversationQueue(conversationId, uuidv4(), 0)
        await chatInterface.clearChatHistory()
    }

    async clear(conversationInfo: ConversationInfo) {
        const { conversationId } = conversationInfo
        delete this._conversations[conversationId]
    }

    async dispose() {
        this._conversations = {}
    }

    private async _createChatInterface(conversationInfo: ConversationInfo): Promise<ChatHubChatBridgerInfo> {

        const presetTemplate = this._parsePresetTemplate(conversationInfo.systemPrompts)

        const chatInterface = new ChatInterface({
            chatMode: conversationInfo.chatMode as any,
            historyMode: this._service.config.historyMode === "default" ? "all" : "summary",
            botName: this._service.config.botName,
            chatHistory: await this._createChatHistory(conversationInfo),
            systemPrompts: formatPresetTemplate(presetTemplate, {
                name: this._service.config.botName,
                date: new Date().toLocaleString(),
            }),
            mixedModelName: conversationInfo.model,
            createParams: {
                longMemory: this._service.config.longMemory,
            }
        })

        await chatInterface.init()

        const result = {
            chatInterface,
            presetTemplate,
        }

        this._conversations[conversationInfo.conversationId] = result

        return result
    }


    private addToConversationQueue(conversationId: string, requestId: string) {
        if (this._conversationQueue[conversationId] == null) {
            this._conversationQueue[conversationId] = []
        }

        this._conversationQueue[conversationId].push(requestId)
    }

    private removeFromConversationQueue(conversationId: string, requestId: string) {
        if (this._conversationQueue[conversationId] == null) {
            this._conversationQueue[conversationId] = []
        }

        const queue = this._conversationQueue[conversationId]

        const index = queue.indexOf(requestId)

        if (index !== -1) {
            queue.splice(index, 1)
        }
    }

    private async waitConversationQueue(conversationId: string, requestId: string, maxQueueLength: number) {

        if (this._conversationQueue[conversationId] == null) {
            this._conversationQueue[conversationId] = []
        }

        const queue = this._conversationQueue[conversationId]
        queue.push(requestId)

        if (queue.length > maxQueueLength) {
            await new Promise<void>((resolve, reject) => {

                const interval = setInterval(() => {
                    if (queue[0] === requestId) {
                        clearInterval(interval)
                        resolve()
                    }
                }, 1000)
            })
        }

        queue.shift()
    }

    private async waitModelQueue(model: string, requestId: string, maxQueueLength: number) {

        if (this._modelQueue[model] == null) {
            this._modelQueue[model] = []
        }

        const queue = this._modelQueue[model]
        queue.push(requestId)

        if (queue.length > maxQueueLength) {
            await new Promise<void>((resolve, reject) => {

                const interval = setInterval(() => {
                    if (queue[0] === requestId) {
                        clearInterval(interval)
                        resolve()
                    }
                }, 1000)
            })
        }

        queue.shift()
    }

    private async _createChatHistory(conversationInfo: ConversationInfo): Promise<BaseChatMessageHistory> {
        const chatMessageHistory = new KoishiDatabaseChatMessageHistory(
            this._service.ctx, conversationInfo.conversationId
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
    interface Context {
        chathub: ChatHubService
    }
}

declare module 'koishi' {
    interface Tables {
        chathub_conversation_info: ConversationInfo
    }
}