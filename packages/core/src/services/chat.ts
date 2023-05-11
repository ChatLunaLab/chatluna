import { Service, Context, Schema, Awaitable, Computed, Disposable } from 'koishi';
import { Config } from '../config';
import { Factory } from '@dingyi222666/chathub-llm-core/lib/chat/factory';
import { EmbeddingsProvider, ModelProvider, VectorStoreRetrieverProvider } from '@dingyi222666/chathub-llm-core/lib/model/base';
import { PromiseLikeDisposeable } from '@dingyi222666/chathub-llm-core/lib/utils/types';
import { ChatInterface } from '@dingyi222666/chathub-llm-core/lib/chat/app';
import { StructuredTool, Tool } from 'langchain/tools';
import { ConversationInfo, Message } from '../types';
import { AIChatMessage, BaseChatMessageHistory, HumanChatMessage } from 'langchain/schema';
import { PresetTemplate, formatPresetTemplate, loadPreset } from '@dingyi222666/chathub-llm-core';
import { KoishiDatabaseChatMessageHistory } from "@dingyi222666/chathub-llm-core/lib/memory/message/database_memory"
import { v4 as uuidv4 } from 'uuid';

export class ChatHubService extends Service {

    private _plugins: ChatHubPlugin<ChatHubPlugin.Config>[] = []
    private _chatBridgers: Record<string, ChatHubChatBridger> = {}

    constructor(public ctx: Context, public config: Config) {
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
            primary: ["conversationId"],
            unique: ["conversationId"],
            autoInc: false,
            foreign: {
                conversationId: ['chathub_conversaion', 'id']
            }
        })

    }


    registerPlugin<T extends ChatHubPlugin.Config>(plugin: ChatHubPlugin<T>) {
        this._plugins.push(plugin)
        
    }

    async unregisterPlugin(plugin: ChatHubPlugin<ChatHubPlugin.Config> | string) {
        const targetPlugin = typeof plugin === "string" ? this._plugins.find(p => p.name === plugin) : plugin

        if (!targetPlugin) {
            throw new Error(`Plugin ${plugin} not found`)
        }

        this._plugins = this._plugins.filter(p => p !== targetPlugin)

        await targetPlugin.onDispose()
    }

    protected async stop(): Promise<void> {
        for (const plugin of this._plugins) {
            await plugin.onDispose()
        }
    }

    async chat(conversationInfo: ConversationInfo, message: Message) {
        const { model } = conversationInfo

        const chatBridger = this._chatBridgers[model] ?? this._createChatBridger(model)

        return await chatBridger.chat(conversationInfo, message)
    }

    async createChatModel(model: string, params?: Record<string, any>) {
        const modelProviders = await Factory.selectModelProviders(async (name, provider) => {
            return (await provider.listModels()).includes(model)
        })

        if (modelProviders.length === 0) {
            throw new Error(`找不到模型 ${model}`)
        } else if (modelProviders.length > 1) {
            throw new Error(`找到多个模型 ${model}`)
        }

        const modelProvider = modelProviders[0]

        return await modelProvider.createModel(model, params ?? {})
    }

    private _createChatBridger(model: string): ChatHubChatBridger {
        const chatBridger = new ChatHubChatBridger(this)
        this._chatBridgers[model] = chatBridger
        return chatBridger
    }
}



export abstract class ChatHubPlugin<T extends ChatHubPlugin.Config> {

    private _disposables: PromiseLikeDisposeable[] = []

    abstract readonly name: string

    protected constructor(protected ctx: Context, public readonly config: T) { }

    async onDispose(): Promise<void> {
        while (this._disposables.length > 0) {
            const disposable = this._disposables.pop()
            await disposable()
        }
    }

    registerModelProvider(provider: ModelProvider) {
        const disposable = Factory.registerModelProvider(provider)
        this._disposables.push(disposable)
    }

    registerEmbeddingsProvider(provider: EmbeddingsProvider) {
        const disposable = Factory.registerEmbeddingsProvider(provider)
        this._disposables.push(disposable)
    }

    registerVectorStoreRetrieverProvider(provider: VectorStoreRetrieverProvider) {
        const disposable = Factory.registerVectorStoreRetrieverProvider(provider)
        this._disposables.push(disposable)
    }

    registerTool(name: string, tool: StructuredTool | Tool) {
        const disposable = Factory.registerTool(name, tool)
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

    constructor(private _service: ChatHubService) {

    }

    async chat(conversationInfo: ConversationInfo, message: Message): Promise<Message> {
        const { conversationId, model } = conversationInfo

        const { chatInterface } = this._conversations[conversationId] ?? await this._createChatInterface(conversationInfo)

        const modelProviders = await Factory.selectModelProviders(async (name, provider) => {
            return (await provider.listModels()).includes(conversationInfo.model)
        })

        if (modelProviders.length === 0) {
            throw new Error(`找不到模型 ${conversationInfo.model}`)
        } else if (modelProviders.length > 1) {
            throw new Error(`找到多个模型 ${conversationInfo.model}`)
        }

        const modelProvider = modelProviders[0]

        const requestId = uuidv4()

        await this.waitQueue(model, requestId, modelProvider.getExtraInfo().maxQueueLength)

        const humanChatMessage = new HumanChatMessage(message.text)


        humanChatMessage.name = message.name

        const chainValues = await chatInterface.chat(
            humanChatMessage)

        return {
            text: (chainValues.message as AIChatMessage).text,
            additionalReplyMessages: (chainValues.additionalReplyMessages as string[])?.map(text => ({
                text,
            })),
        }
    }

    private async _createChatInterface(conversationInfo: ConversationInfo): Promise<ChatHubChatBridgerInfo> {

        const presetTemplate = this._parsePresetTemplate(conversationInfo.systemPrompts)

        const chatInterface = new ChatInterface({
            chatMode: conversationInfo.chatMode as any,
            historyMode: this._service.config.historyMode as any,
            botName: this._service.config.botName,
            chatHistory: await this._createChatHistory(conversationInfo),
            systemPrompts: formatPresetTemplate(presetTemplate, {
                name: this._service.config.botName,
                date: new Date().toLocaleString(),
            }),
            mixedModelName: conversationInfo.model,
            createParams: {}
        })

        await chatInterface.init()

        return {
            chatInterface,
            presetTemplate,
        }
    }


    private async waitQueue(model: string, requestId: string, maxQueueLength: number) {

        if (this._modelQueue[model] == null) {
            this._modelQueue[model] = []
        }

        const queue = this._modelQueue[model]

        if (queue.length >= maxQueueLength) {
            await new Promise<void>((resolve, reject) => {
                queue.push(requestId)

                const interval = setInterval(() => {
                    if (queue[0] === requestId) {
                        clearInterval(interval)
                        resolve()
                    }
                }, 1000)
            })
        } else {
            queue.push(requestId)
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

    async dispose() {
        this._conversations = {}
    }
}


export namespace ChatHubPlugin {

    export interface Config {
        chatConcurrentMaxSize?: number,
        chatTimeLimit?: Computed<Awaitable<number>>,
        timeout?: number,
    }


    export const Config: Schema<ChatHubPlugin.Config> = Schema.object({
        chatConcurrentMaxSize: Schema.number().min(0).max(4).default(0).description('当前适配器适配的模型的最大并发聊天数'),
        chatTimeLimit: Schema.union([
            Schema.natural(),
            Schema.any().hidden(),
        ]).role('computed').default(20).description('每小时的调用限额(次数)'),
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