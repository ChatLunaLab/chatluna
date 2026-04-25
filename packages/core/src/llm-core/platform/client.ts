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
    FileHandlingConfig,
    ModelCapabilities,
    ModelInfo,
    PlatformClientNames
} from 'koishi-plugin-chatluna/llm-core/platform/types'
import { ObjectLock } from 'koishi-plugin-chatluna/utils/lock'
import { RunnableConfig } from '@langchain/core/runnables'
import {
    ChatLunaError,
    ChatLunaErrorCode
} from 'koishi-plugin-chatluna/utils/error'

export type { FileHandlingConfig }

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

    async isAvailable(config?: RunnableConfig): Promise<boolean> {
        if (Object.values(this._modelInfos).length > 0) {
            return true
        }

        const unlock = await this._lock.lock()

        let retryCount = 0

        const cfg =
            this.configPool.findAvailableConfig() ??
            this.configPool.getConfigs()[0]

        if (cfg == null) {
            unlock()
            return false
        }

        const maxRetries = cfg.value.maxRetries ?? 5

        while (retryCount < (maxRetries ?? 1)) {
            try {
                await this.init(config)
                unlock()
                return true
            } catch (e) {
                if (
                    e instanceof ChatLunaError &&
                    e.errorCode === ChatLunaErrorCode.ABORTED
                ) {
                    unlock()
                    throw e
                }

                if (retryCount === maxRetries - 1) {
                    const oldConfig = this.configPool.findAvailableConfig()

                    if (oldConfig == null) {
                        this.ctx.logger.error(e)
                        unlock()
                        return false
                    }

                    // refresh
                    this.configPool.getConfig(false)

                    this.configPool.markConfigStatus(oldConfig.value, false)

                    this.ctx.logger.error(e)

                    if (this.configPool.findAvailableConfig() != null) {
                        retryCount = 0
                        continue
                    }

                    unlock()
                    return false
                }
            }

            retryCount++
        }

        unlock()

        return false
    }

    get config(): T | undefined {
        return this.configPool.getConfig(true).value
    }

    async getModels(config?: RunnableConfig): Promise<ModelInfo[]> {
        let models = Object.values(this._modelInfos)

        if (models.length > 0) {
            return models
        }

        try {
            models = await this.refreshModels(config)
            this._modelInfos = {}

            for (const model of models) {
                model.capabilities = model.capabilities.includes(
                    ModelCapabilities.ImageGeneration
                )
                    ? [ModelCapabilities.ImageGeneration]
                    : Array.from(
                          new Set([
                              ...model.capabilities,
                              ModelCapabilities.TextInput
                          ])
                      )
                this._modelInfos[model.name] = model
            }

            return models
        } catch (e) {
            if (
                e instanceof ChatLunaError &&
                e.errorCode === ChatLunaErrorCode.ABORTED
            ) {
                throw e
            }

            this.ctx.logger.error(e)
            this._modelInfos = {}
            throw e
        }
    }

    async init(config?: RunnableConfig): Promise<void> {
        await this.getModels(config)
    }

    abstract refreshModels(config?: RunnableConfig): Promise<ModelInfo[]>

    /**
     * Returns file handling configuration for this platform, or `null` if the
     * platform does not support inline file uploads beyond basic image input.
     *
     * Override in subclasses to provide platform-specific MIME types, size
     * limits, and inline data support.
     */
    getFileHandlingConfig(): FileHandlingConfig | null {
        return null
    }

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
