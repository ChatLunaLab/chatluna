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
import { ObjectLock } from 'koishi-plugin-chatluna/utils/lock'

export abstract class BasePlatformClient<
    T extends ClientConfig = ClientConfig,
    R = ChatLunaChatModel | ChatLunaBaseEmbeddings
> {
    private _modelPool: Record<string, R> = {}

    protected _modelInfos: Record<string, ModelInfo> = {}

    private _lock = new ObjectLock()

    abstract platform: PlatformClientNames

    constructor(
        public ctx: Context,
        public configPool: ClientConfigPool<T>
    ) {}

    async isAvailable(): Promise<boolean> {
        if (Object.values(this._modelInfos).length > 0) {
            return true
        }

        const unlock = await this._lock.lock()

        let retryCount = 0

        while (retryCount < (this.config.maxRetries ?? 1)) {
            try {
                await this.init()
                unlock()
                return true
            } catch (e) {
                this.ctx.logger.error(e)

                if (retryCount === this.config.maxRetries - 1) {
                    const oldConfig = this.configPool.getConfig(true)

                    // refresh
                    this.configPool.getConfig(false)

                    this.configPool.markConfigStatus(oldConfig.value, false)

                    if (this.configPool.findAvailableConfig() !== null) {
                        retryCount = 0
                        continue
                    }

                    unlock()
                    return false
                }
            }

            retryCount++
        }
    }

    get config(): T {
        return this.configPool.getConfig(true).value
    }

    async getModels(): Promise<ModelInfo[]> {
        let models = Object.values(this._modelInfos)

        if (models.length > 0) {
            return models
        }

        models = await this.refreshModels()
        this._modelInfos = {}

        for (const model of models) {
            this._modelInfos[model.name] = model
        }
    }

    async init(): Promise<void> {
        await this.getModels()
    }

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
> extends BasePlatformClient<T, ChatLunaBaseEmbeddings> {}

export abstract class PlatformModelAndEmbeddingsClient<
    T extends ClientConfig = ClientConfig
> extends BasePlatformClient<T> {}
