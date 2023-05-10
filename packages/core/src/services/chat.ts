import { Service, Context, Schema, Awaitable, Computed, Disposable } from 'koishi';
import { Config } from '../config';
import { Factory } from '@dingyi222666/chathub-llm-core/lib/chat/factory';
import { EmbeddingsProvider, ModelProvider, VectorStoreRetrieverProvider } from '@dingyi222666/chathub-llm-core/lib/model/base';
import { PromiseLikeDisposeable } from '@dingyi222666/chathub-llm-core/lib/utils/types';
import { ChatInterface } from '@dingyi222666/chathub-llm-core/lib/chat/app';
import { StructuredTool, Tool } from 'langchain/dist/tools/base';
import { ConversationInfo, Message } from '../types';
import { Cache } from '../cache';
import { SystemPrompts } from '@dingyi222666/chathub-llm-core/lib/chain/base';
import { BaseChatMessageHistory } from 'langchain/dist/schema';
import { PresetTemplate, formatPresetTemplate, loadPreset } from '@dingyi222666/chathub-llm-core';
import { KoishiDatabaseChatMessageHistory } from "@dingyi222666/chathub-llm-core/lib/memory/message/database_memory"

export class ChatHubService extends Service {

    private _plugins: ChatHubPlugin<ChatHubPlugin.Config>[] = []

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
}



export abstract class ChatHubPlugin<T extends ChatHubPlugin.Config> {

    private _disposables: PromiseLikeDisposeable[] = []

    protected abstract readonly name: string

    protected constructor(protected ctx: Context, public readonly config: T) { }

    abstract init(ctx: Context, config: T, factory: Factory): Promise<void>

    onDispose(): void {
        while (this._disposables.length > 0) {
            const disposable = this._disposables.pop()
            disposable?.()
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

    constructor(private _service: ChatHubService, private _plugin: ChatHubPlugin<ChatHubPlugin.Config>) {

    }


    async chat(conversationInfo: ConversationInfo, message: Message): Promise<Message> {
        const { senderId, conversationId, model } = conversationInfo

        const chatInfo = this._conversations[conversationId] ?? await this._createChatInterface(conversationInfo)

        throw new Error("Method not implemented.");
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

        return {
            chatInterface,
            presetTemplate,
        }
    }

    private async _createChatHistory(conversationInfo: ConversationInfo): Promise<BaseChatMessageHistory> {
        const chatMessageHistory = new KoishiDatabaseChatMessageHistory(
            this._service.ctx,conversationInfo.conversationId
        )

        await chatMessageHistory.loadConversation()

        return chatMessageHistory
    }

    private _parsePresetTemplate(systemPrompts: string): PresetTemplate {
        return loadPreset(systemPrompts)
    }

    async dispose() {
        this._conversations = {}
        this._plugin.onDispose()
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