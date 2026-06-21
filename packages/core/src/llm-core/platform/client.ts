import { Context, sleep } from 'koishi'
import {
    ClientConfig,
    ClientConfigPool,
    ClientConfigWrapper
} from 'koishi-plugin-chatluna/llm-core/platform/config'
import {
    ChatLunaBaseEmbeddings,
    ChatLunaChatModel
} from 'koishi-plugin-chatluna/llm-core/platform/model'
import { ChatLunaReranker } from 'koishi-plugin-chatluna/llm-core/platform/rerank'
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
import {
    createModelUsageReporter,
    type ModelUsageReporter
} from 'koishi-plugin-chatluna/llm-core/platform/usage'
import { usageSourceFromStack } from 'koishi-plugin-chatluna/utils/usage_source'

export type { FileHandlingConfig }

export abstract class BasePlatformClient<
    T extends ClientConfig = ClientConfig,
    R = ChatLunaChatModel | ChatLunaBaseEmbeddings | ChatLunaReranker
> {
    private _modelPool: Record<string, R> = {}

    private _reports: Record<string, ModelUsageReporter> = {}

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

        while (retryCount <= maxRetries) {
            let oldConfig: ClientConfigWrapper<T> | undefined

            try {
                oldConfig = this.configPool.getConfig(true)
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

                if (
                    e instanceof ChatLunaError &&
                    e.errorCode === ChatLunaErrorCode.NOT_AVAILABLE_CONFIG
                ) {
                    unlock()
                    return false
                }

                if (retryCount >= maxRetries) {
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

            await sleep(1000 * 2 ** retryCount)
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

            const err = e instanceof Error ? e : new Error(String(e))
            const cause = err instanceof ChatLunaError ? err.originError : null
            const reason = cause?.message ?? err.message

            err.message = `获取模型列表失败 (${this.platform}): ${reason}`

            this.ctx.logger.error(err)
            this._modelInfos = {}
            throw err
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

    protected abstract _createModel(
        model: string,
        report: ModelUsageReporter
    ): R

    createModel(model: string): R {
        const limit = Error.stackTraceLimit
        Error.stackTraceLimit = Math.max(limit, 50)
        const stack = new Error().stack
        Error.stackTraceLimit = limit
        const source = usageSourceFromStack(stack)
        const key = `${source}:${model}`
        const report =
            this._reports[key] ??
            createModelUsageReporter(this.ctx, this.platform, model, stack)
        this._reports[key] = report

        if (!this._modelPool[key]) {
            this._modelPool[key] = this._createModel(model, report)
        }

        return this._modelPool[key]
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
> extends BasePlatformClient<T, ChatLunaChatModel | ChatLunaBaseEmbeddings> {}

export abstract class PlatformRerankerClient<
    T extends ClientConfig = ClientConfig
> extends BasePlatformClient<T, ChatLunaReranker> {}

export abstract class PlatformModelEmbeddingsAndRerankerClient<
    T extends ClientConfig = ClientConfig
> extends BasePlatformClient<
    T,
    ChatLunaChatModel | ChatLunaBaseEmbeddings | ChatLunaReranker
> {}
