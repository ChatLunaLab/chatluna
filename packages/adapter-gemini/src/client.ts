import { Context } from 'koishi'
import {
    FileHandlingConfig,
    PlatformModelAndEmbeddingsClient
} from 'koishi-plugin-chatluna/llm-core/platform/client'
import { ClientConfig } from 'koishi-plugin-chatluna/llm-core/platform/config'
import {
    ChatLunaBaseEmbeddings,
    ChatLunaChatModel,
    ChatLunaEmbeddings
} from 'koishi-plugin-chatluna/llm-core/platform/model'
import {
    ModelInfo,
    ModelType
} from 'koishi-plugin-chatluna/llm-core/platform/types'
import {
    ChatLunaError,
    ChatLunaErrorCode
} from 'koishi-plugin-chatluna/utils/error'
import { Config, logger } from '.'
import { GeminiRequester } from './requester'
import { ChatLunaPlugin } from 'koishi-plugin-chatluna/services/chat'
import { RunnableConfig } from '@langchain/core/runnables'
import { GeminiModelInfo } from './types'
import {
    createGeminiCapabilities,
    getModelVariantSuffixes,
    isGeminiModelName,
    shouldFilterOutGeminiModel
} from './utils'

// #region GeminiClient

import type { ModelUsageReporter } from 'koishi-plugin-chatluna/llm-core/platform/usage'

export class GeminiClient extends PlatformModelAndEmbeddingsClient<ClientConfig> {
    platform = 'gemini'

    private _requester: GeminiRequester

    get logger() {
        return logger
    }

    // #region constructor

    constructor(
        ctx: Context,
        private _config: Config,
        public plugin: ChatLunaPlugin<ClientConfig, Config>
    ) {
        super(ctx, plugin.platformConfigPool)

        this.platform = this._config.platform

        this._requester = new GeminiRequester(
            ctx,
            plugin.platformConfigPool,
            this._config,
            plugin
        )
    }

    // #endregion

    // #region getFileHandlingConfig

    private static readonly _fileHandlingConfig: FileHandlingConfig = {
        supportedMimeTypes: new Set<string>([
            'text/html',
            'text/css',
            'text/plain',
            'text/markdown',
            'text/xml',
            'text/csv',
            'text/rtf',
            'text/javascript',
            'application/json',
            'application/pdf',
            'image/bmp',
            'image/jpeg',
            'image/png',
            'image/webp',
            'audio/mpeg',
            'audio/mp3',
            'audio/aiff',
            'audio/aac',
            'audio/flac',
            'audio/wav',
            'audio/webm',
            'audio/ogg',
            'audio/mp4',
            'video/mp4',
            'video/mpeg',
            'video/mov',
            'video/avi',
            'video/x-flv',
            'video/mpg',
            'video/webm',
            'video/wmv',
            'video/3gpp'
        ]),
        maxTotalSizeBytes: 100 * 1024 * 1024,
        maxFileSizeBytes: 100 * 1024 * 1024,
        maxFileSizeBytesOverrides: {
            'application/pdf': 50 * 1024 * 1024
        }
    }

    getFileHandlingConfig(): FileHandlingConfig {
        return GeminiClient._fileHandlingConfig
    }

    // #endregion

    // #region refreshModels

    /**
     * 从配置与 API 获取模型列表，并将特定系列展开为变体
     * （图片分辨率 / 搜索后缀、thinking 开关与等级）。
     */
    async refreshModels(config?: RunnableConfig): Promise<ModelInfo[]> {
        let rawModels: GeminiModelInfo[] = []

        try {
            rawModels = this._config.pullModels
                ? await this._requester.getModels(config)
                : []

            if (this._config.pullModels && rawModels.length === 0) {
                throw new ChatLunaError(
                    ChatLunaErrorCode.MODEL_INIT_ERROR,
                    new Error('No model found')
                )
            }
        } catch (e) {
            if (e instanceof ChatLunaError) throw e
            throw new ChatLunaError(ChatLunaErrorCode.MODEL_INIT_ERROR, e)
        }

        const items: ModelInfo[] = this._config.additionalModels.map(
            (model) => {
                const name = model.model.toLowerCase()
                const isEmbedding = model.modelType === 'Embeddings 嵌入模型'

                return {
                    name: model.model,
                    maxTokens: model.contextSize,
                    type: isEmbedding ? ModelType.embeddings : ModelType.llm,
                    capabilities: isEmbedding
                        ? []
                        : isGeminiModelName(name)
                          ? createGeminiCapabilities(name, false)
                          : model.modelCapabilities
                }
            }
        )

        for (const model of rawModels) {
            const name = model.name.toLowerCase()

            if (shouldFilterOutGeminiModel(name)) continue

            const isEmbedding = name.includes('embedding')

            items.push({
                name: model.name,
                maxTokens: model.inputTokenLimit,
                type: isEmbedding ? ModelType.embeddings : ModelType.llm,
                capabilities: createGeminiCapabilities(name, isEmbedding)
            })
        }

        const models: ModelInfo[] = []
        const names = new Set<string>()
        const addModel = (model: ModelInfo) => {
            const key = model.name.toLowerCase()
            if (!names.has(key)) {
                names.add(key)
                models.push(model)
            }
        }

        for (const model of items) {
            const suffixes = getModelVariantSuffixes(
                model.name.toLowerCase(),
                this._config.imageModelSearch
            )

            for (const suffix of suffixes) {
                addModel({ ...model, name: model.name + suffix })
            }
            addModel(model)
        }

        if (models.length === 0) {
            throw new ChatLunaError(
                ChatLunaErrorCode.MODEL_INIT_ERROR,
                new Error('No model configured')
            )
        }

        return models
    }

    // #endregion

    // #region _createModel

    /**
     * 根据模型名创建对应的 ChatLunaChatModel 或 ChatLunaEmbeddings 实例。
     */
    protected _createModel(
        model: string,
        report: ModelUsageReporter
    ): ChatLunaChatModel | ChatLunaBaseEmbeddings {
        const info = this._modelInfos[model]

        if (info == null) {
            logger.warn(
                `Model ${model} not found`,
                JSON.stringify(this._modelInfos)
            )
            throw new ChatLunaError(ChatLunaErrorCode.MODEL_NOT_FOUND)
        }

        if (info.type === ModelType.llm) {
            return new ChatLunaChatModel({
                usageReporter: report,
                modelInfo: info,
                requester: this._requester,
                model,
                modelMaxContextSize: info.maxTokens,
                maxTokenLimit: Math.floor(
                    (info.maxTokens || 100_000) * this._config.maxContextRatio
                ),
                timeout: this._config.timeout,
                temperature: this._config.temperature,
                maxRetries: this._config.maxRetries,
                fileHandlingConfig: this.getFileHandlingConfig(),
                llmType: this.platform
            })
        }

        return new ChatLunaEmbeddings({
            usageReporter: report,
            client: this._requester,
            model,
            maxRetries: this._config.maxRetries
        })
    }

    // #endregion
}

// #endregion
