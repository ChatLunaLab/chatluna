import { Context } from 'koishi'
import {
    ClientConfig,
    ClientConfigPool
} from 'koishi-plugin-chatluna/llm-core/platform/config'
import {
    ChatLunaBaseEmbeddings,
    ChatLunaChatModel
} from 'koishi-plugin-chatluna/llm-core/platform/model'
import {
    ModelInfo,
    PlatformClientNames
} from 'koishi-plugin-chatluna/llm-core/platform/types'
import { RunnableConfig } from '@langchain/core/runnables'
export declare abstract class BasePlatformClient<
    T extends ClientConfig = ClientConfig,
    R = ChatLunaChatModel | ChatLunaBaseEmbeddings
> {
    ctx: Context
    configPool: ClientConfigPool<T>
    private _modelPool
    protected _modelInfos: Record<string, ModelInfo>
    private _lock
    abstract platform: PlatformClientNames
    constructor(ctx: Context, configPool: ClientConfigPool<T>)
    isAvailable(config?: RunnableConfig): Promise<boolean>
    get config(): T | undefined
    getModels(config?: RunnableConfig): Promise<ModelInfo[]>
    init(config?: RunnableConfig): Promise<void>
    abstract refreshModels(config?: RunnableConfig): Promise<ModelInfo[]>
    protected abstract _createModel(model: string): R
    createModel(model: string): R
}
export declare abstract class PlatformModelClient<
    T extends ClientConfig = ClientConfig
> extends BasePlatformClient<T, ChatLunaChatModel> {
    clearContext(): Promise<void>
}
export declare abstract class PlatformEmbeddingsClient<
    T extends ClientConfig = ClientConfig
> extends BasePlatformClient<T, ChatLunaBaseEmbeddings> {}
export declare abstract class PlatformModelAndEmbeddingsClient<
    T extends ClientConfig = ClientConfig
> extends BasePlatformClient<T> {}
