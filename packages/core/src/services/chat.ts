import { Service, Context, Schema, Awaitable, Computed, Disposable } from 'koishi';
import { Config } from '../config';
import { Factory } from '@dingyi222666/chathub-llm-core/lib/chat/factory';
import { EmbeddingsProvider, ModelProvider, VectorStoreRetrieverProvider } from '@dingyi222666/chathub-llm-core/lib/model/base';
import { StructuredTool, Tool } from 'langchain/dist/tools/base';

export class ChatHubService extends Service {

    constructor(public ctx: Context, public config: Config) {
        super(ctx, "chathub")
    }
}


export abstract class ChatHubPlugin<T extends ChatHubPlugin.Config> {


    private _disposables: Disposable[] = []

    protected abstract readonly name: string

    protected constructor(protected ctx: Context, public config: T) {

    }

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

export namespace ChatHubPlugin {

    export interface Config {
        chatConcurrentMaxSize?: number,
        chatTimeLimit?: Computed<Awaitable<number>>,
        timeout?: number,
    }


    export const Config: Schema<ChatHubPlugin.Config> = Schema.object({
        conversationChatConcurrentMaxSize: Schema.number().min(0).max(4).default(0).description('会话中最大并发聊天数'),
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
