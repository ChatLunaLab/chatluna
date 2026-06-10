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
import { createGeminiCapabilities, shouldFilterOutGeminiModel } from './utils'

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
     * 从 API 获取模型列表，并将每个模型展开为对应的所有变体：
     * - 图片生成模型：分辨率 + 搜索后缀变体
     * - gemini-2.5 系列：-thinking / -non-thinking 变体
     * - gemini-3 系列：thinking 等级变体（low / medium / high / minimal）
     * - 其他模型：直接加入，不展开
     */
    async refreshModels(config?: RunnableConfig): Promise<ModelInfo[]> {
        // --- 获取原始模型列表 ---
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

        const items: ModelInfo[] = []

        for (const model of this._config.additionalModels) {
            const name = model.model.toLowerCase()
            const type =
                model.modelType === 'Embeddings 嵌入模型'
                    ? ModelType.embeddings
                    : ModelType.llm

            items.push({
                name: model.model,
                maxTokens: model.contextSize,
                type,
                capabilities:
                    type === ModelType.embeddings
                        ? []
                        : name.includes('gemini')
                          ? createGeminiCapabilities(name, false)
                          : model.modelCapabilities
            })
        }
        for (const model of rawModels) {
            const name = model.name.toLowerCase()

            if (shouldFilterOutGeminiModel(name)) continue

            const type = name.includes('embedding')
                ? ModelType.embeddings
                : ModelType.llm

            items.push({
                name: model.name,
                maxTokens: model.inputTokenLimit,
                type,
                capabilities: createGeminiCapabilities(
                    name,
                    type === ModelType.embeddings
                )
            })
        }

        const models: ModelInfo[] = []
        const names = new Set<string>()

        for (const model of items) {
            const name = model.name.toLowerCase()
            const suffixes: string[] = []

            if (name.includes('gemini-3-pro-image')) {
                suffixes.push('-2k', '-4k')
                if (this._config.imageModelSearch) {
                    suffixes.push('-search', '-2k-search', '-4k-search')
                }
            } else if (name.includes('gemini-3.1-flash-image')) {
                suffixes.push('-0.5k', '-2k', '-4k')
                if (this._config.imageModelSearch) {
                    suffixes.push(
                        '-search',
                        '-0.5k-search',
                        '-2k-search',
                        '-4k-search'
                    )
                }
            } else if (
                name.includes('gemini-2.5') &&
                !name.includes('image') &&
                !name.includes('-thinking')
            ) {
                suffixes.push('-non-thinking', '-thinking')
            } else if (
                (name.includes('gemini-3-pro') ||
                    name.includes('gemini-3-flash') ||
                    name.includes('gemini-3.1-pro')) &&
                !name.includes('image')
            ) {
                suffixes.push('-low-thinking', '-high-thinking')
                suffixes.push('-minimal-thinking')
                if (!/gemini-3(\.1)?-pro/.test(name)) {
                    suffixes.push('-medium-thinking')
                }
            }

            for (const suffix of suffixes) {
                const full = model.name + suffix
                if (!names.has(full)) {
                    names.add(full)
                    models.push({ ...model, name: full })
                }
            }

            if (names.has(model.name)) continue

            names.add(model.name)
            models.push(model)
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
