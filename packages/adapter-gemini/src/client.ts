import { Context } from 'koishi'
import { PlatformModelAndEmbeddingsClient } from 'koishi-plugin-chatluna/llm-core/platform/client'
import { ClientConfig } from 'koishi-plugin-chatluna/llm-core/platform/config'
import {
    ChatLunaBaseEmbeddings,
    ChatLunaChatModel,
    ChatLunaEmbeddings
} from 'koishi-plugin-chatluna/llm-core/platform/model'
import {
    ModelCapabilities,
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
import { expandModelVariants } from './utils'

// #region GeminiClient

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
            rawModels = await this._requester.getModels(config)

            if (rawModels.length === 0) {
                throw new ChatLunaError(
                    ChatLunaErrorCode.MODEL_INIT_ERROR,
                    new Error('No model found')
                )
            }
        } catch (e) {
            if (e instanceof ChatLunaError) throw e
            throw new ChatLunaError(ChatLunaErrorCode.MODEL_INIT_ERROR, e)
        }

        // --- 将原始模型转换并展开为变体列表 ---
        const models: ModelInfo[] = []

        for (const model of rawModels) {
            const modelNameLower = model.name.toLowerCase()
            const isEmbedding = modelNameLower.includes('embedding')

            const baseInfo: ModelInfo = {
                name: model.name,
                maxTokens: model.inputTokenLimit,
                type: isEmbedding ? ModelType.embeddings : ModelType.llm,
                capabilities: isEmbedding
                    ? []
                    : [ModelCapabilities.ImageInput, ModelCapabilities.ToolCall]
            }

            // 尝试展开特殊变体；未命中则直接加入
            if (
                !expandModelVariants(
                    models,
                    baseInfo,
                    this._config.imageModelSearch
                )
            ) {
                models.push(baseInfo)
            }
        }

        return models
    }

    // #endregion

    // #region _createModel

    /**
     * 根据模型名创建对应的 ChatLunaChatModel 或 ChatLunaEmbeddings 实例。
     */
    protected _createModel(
        model: string
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
                llmType: this.platform
            })
        }

        return new ChatLunaEmbeddings({
            client: this._requester,
            model,
            maxRetries: this._config.maxRetries
        })
    }

    // #endregion
}

// #endregion
