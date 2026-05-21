import { Context } from 'koishi'
import { PlatformModelEmbeddingsAndRerankerClient } from 'koishi-plugin-chatluna/llm-core/platform/client'
import {
    ChatLunaBaseEmbeddings,
    ChatLunaChatModel,
    ChatLunaEmbeddings
} from 'koishi-plugin-chatluna/llm-core/platform/model'
import { ChatLunaReranker } from 'koishi-plugin-chatluna/llm-core/platform/rerank'
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
import { OpenAIRequester } from './requester'
import { ChatLunaPlugin } from 'koishi-plugin-chatluna/services/chat'
import {
    getModelMaxContextSize,
    getOpenAIFileHandlingConfig,
    isEmbeddingModel,
    isImageGenerationModel,
    isNonLLMModel,
    isRerankerModel,
    supportAudioInput,
    supportImageInput
} from '@chatluna/v1-shared-adapter'
import { RunnableConfig } from '@langchain/core/runnables'

import type { ModelUsageReporter } from 'koishi-plugin-chatluna/llm-core/platform/usage'

export class OpenAIClient extends PlatformModelEmbeddingsAndRerankerClient {
    platform = 'openai'

    private _requester: OpenAIRequester

    constructor(
        ctx: Context,
        private _config: Config,
        public plugin: ChatLunaPlugin
    ) {
        super(ctx, plugin.platformConfigPool)
        this.platform = _config.platform
        this._requester = new OpenAIRequester(
            ctx,
            plugin.platformConfigPool,
            _config,
            plugin
        )
    }

    async refreshModels(config?: RunnableConfig): Promise<ModelInfo[]> {
        try {
            const rawModels = this._config.pullModels
                ? await this._requester.getModels(config)
                : []

            const additionalModels = this._config.additionalModels.map(
                ({ model, modelType, contextSize, modelCapabilities }) =>
                    ({
                        name: model,
                        type:
                            modelType === 'Embeddings 嵌入模型'
                                ? ModelType.embeddings
                                : modelType === 'Reranker 重排序模型'
                                  ? ModelType.reranker
                                  : ModelType.llm,
                        capabilities: modelCapabilities,
                        maxTokens: contextSize ?? 4096
                    }) as ModelInfo
            )

            const filteredModels = rawModels.filter(
                (model) =>
                    !isNonLLMModel(model) || isImageGenerationModel(model)
            )

            const blacklist = this._config.blacklistModels
                .map((keyword) => keyword.trim().toLowerCase())
                .filter((keyword) => keyword.length > 0)

            const supportToolCalling = (model: string) => {
                // const lower = model.toLowerCase()

                if (isImageGenerationModel(model)) {
                    return {
                        capabilities: [ModelCapabilities.ImageGeneration]
                    }
                }

                return {
                    capabilities: [
                        ModelCapabilities.ToolCall,
                        supportImageInput(model)
                            ? ModelCapabilities.ImageInput
                            : null,
                        supportAudioInput(model)
                            ? ModelCapabilities.AudioInput
                            : null
                    ].filter(Boolean)
                }
            }

            const formattedModels = filteredModels
                .filter((model) => {
                    const id = model.toLowerCase()
                    return !blacklist.some((keyword) => id.includes(keyword))
                })
                .map(
                    (model) =>
                        ({
                            name: model,
                            type: isRerankerModel(model)
                                ? ModelType.reranker
                                : isEmbeddingModel(model)
                                  ? ModelType.embeddings
                                  : ModelType.llm,
                            ...supportToolCalling(model)
                        }) as ModelInfo
                )

            return additionalModels.concat(
                formattedModels.filter(
                    (model) =>
                        additionalModels.findIndex(
                            (additionalModel) =>
                                additionalModel.name === model.name
                        ) === -1
                )
            )
        } catch (e) {
            if (e instanceof ChatLunaError) {
                throw e
            }
            throw new ChatLunaError(ChatLunaErrorCode.MODEL_INIT_ERROR, e)
        }
    }

    protected _createModel(
        model: string,
        report: ModelUsageReporter,
        source: string
    ): ChatLunaChatModel | ChatLunaBaseEmbeddings | ChatLunaReranker {
        const info = this._modelInfos[model]

        if (info == null) {
            logger.warn(
                `Model ${model} not found`,
                JSON.stringify(this._modelInfos)
            )
            throw new ChatLunaError(
                ChatLunaErrorCode.MODEL_NOT_FOUND,
                new Error(
                    `The model ${model} is not found in the models: ${JSON.stringify(Object.keys(this._modelInfos))}`
                )
            )
        }

        if (info.type === ModelType.llm) {
            const modelMaxContextSize = getModelMaxContextSize(info)
            return new ChatLunaChatModel({
                usageReporter: report,
                usageSource: source,
                modelInfo: info,
                requester: this._requester,
                model,
                maxTokenLimit: Math.floor(
                    (info.maxTokens || modelMaxContextSize || 128_000) *
                        this._config.maxContextRatio
                ),
                modelMaxContextSize,
                frequencyPenalty: this._config.frequencyPenalty,
                presencePenalty: this._config.presencePenalty,
                timeout: this._config.timeout,
                temperature: this._config.temperature,
                maxRetries: this._config.maxRetries,
                llmType: 'openai',
                fileHandlingConfig: getOpenAIFileHandlingConfig(model),
                isThinkModel:
                    model.includes('reasoner') ||
                    model.includes('r1') ||
                    model.includes('thinking')
            })
        }

        if (info.type === ModelType.reranker) {
            return new ChatLunaReranker({
                usageReporter: report,
                usageSource: source,
                client: this._requester,
                model,
                maxRetries: this._config.maxRetries,
                timeout: this._config.timeout
            })
        }

        return new ChatLunaEmbeddings({
            usageReporter: report,
            usageSource: source,
            client: this._requester,
            model,
            maxRetries: this._config.maxRetries
        })
    }
}
