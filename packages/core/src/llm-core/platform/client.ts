import { Context } from 'koishi'
import { ClientConfig } from './config'
import { ChatHubBaseEmbeddings, ChatLunaChatModel } from './model'
import { ModelInfo, PlatformClientNames } from './types'

export abstract class BasePlatformClient<
    T extends ClientConfig = ClientConfig,
    R = ChatLunaChatModel | ChatHubBaseEmbeddings
> {
    private _modelPool: Record<string, R> = {}

    abstract platform: PlatformClientNames

    constructor(
        public ctx: Context,
        public config: T
    ) {}

    async isAvailable(): Promise<boolean> {
        for (let i = 0; i < (this.config.maxRetries ?? 1); i++) {
            try {
                await this.init()
                return true
            } catch (e) {
                this.ctx.chatluna.logger.error(e)
                if (i === this.config.maxRetries - 1) {
                    return false
                }
            }
        }
    }

    abstract init(): Promise<void>

    abstract getModels(): Promise<ModelInfo[]>

    abstract refreshModels(): Promise<ModelInfo[]>

    protected abstract _createModel(model: string): R

    createModel(model: string): R {
        if (!this._modelPool[model]) {
            this._modelPool[model] = this._createModel(model)
        }

        return this._modelPool[model]
    }
}

export abstract class PlatformModelClient<
    T extends ClientConfig = ClientConfig
> extends BasePlatformClient<T, ChatLunaChatModel> {
    async clearContext(): Promise<void> {}
}

export abstract class PlatformEmbeddingsClient<
    T extends ClientConfig = ClientConfig
> extends BasePlatformClient<T, ChatHubBaseEmbeddings> {
    async init(): Promise<void> {}
}

export abstract class PlatformModelAndEmbeddingsClient<
    T extends ClientConfig = ClientConfig
> extends BasePlatformClient<T, ChatLunaChatModel | ChatHubBaseEmbeddings> {
    async clearContext(): Promise<void> {}
}
