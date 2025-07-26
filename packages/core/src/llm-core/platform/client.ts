import { Context } from 'koishi'
import { ClientConfig } from 'koishi-plugin-chatluna/llm-core/platform/config'
import {
    ChatLunaBaseEmbeddings,
    ChatLunaChatModel
} from 'koishi-plugin-chatluna/llm-core/platform/model'
import {
    ModelInfo,
    PlatformClientNames
} from 'koishi-plugin-chatluna/llm-core/platform/types'

export abstract class BasePlatformClient<
    T extends ClientConfig = ClientConfig,
    R = ChatLunaChatModel | ChatLunaBaseEmbeddings
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
                this.ctx.logger.error(e)
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
    protected _modelInfos: Record<string, ModelInfo> = {}

    async clearContext(): Promise<void> {}

    async getModels(): Promise<ModelInfo[]> {
        if (this._modelInfos) {
            return Object.values(this._modelInfos)
        }

        const models = await this.refreshModels()

        this._modelInfos = {}

        for (const model of models) {
            this._modelInfos[model.name] = model
        }
    }

    async init(): Promise<void> {
        await this.getModels()
    }
}

export abstract class PlatformEmbeddingsClient<
    T extends ClientConfig = ClientConfig
> extends BasePlatformClient<T, ChatLunaBaseEmbeddings> {
    protected _modelInfos: Record<string, ModelInfo> = {}

    async getModels(): Promise<ModelInfo[]> {
        if (this._modelInfos) {
            return Object.values(this._modelInfos)
        }

        const models = await this.refreshModels()

        this._modelInfos = {}

        for (const model of models) {
            this._modelInfos[model.name] = model
        }
    }

    async init(): Promise<void> {
        await this.getModels()
    }
}

export abstract class PlatformModelAndEmbeddingsClient<
    T extends ClientConfig = ClientConfig
> extends BasePlatformClient<T> {
    protected _modelInfos: Record<string, ModelInfo> = {}

    async clearContext(): Promise<void> {}

    async getModels(): Promise<ModelInfo[]> {
        if (this._modelInfos) {
            return Object.values(this._modelInfos)
        }

        const models = await this.refreshModels()

        this._modelInfos = {}

        for (const model of models) {
            this._modelInfos[model.name] = model
        }
    }

    async init(): Promise<void> {
        await this.getModels()
    }
}
