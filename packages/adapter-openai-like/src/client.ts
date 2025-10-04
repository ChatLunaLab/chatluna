import { Context } from 'koishi'
import { PlatformModelAndEmbeddingsClient } from 'koishi-plugin-chatluna/llm-core/platform/client'
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
import { Config } from '.'
import { OpenAIRequester } from './requester'
import { ChatLunaPlugin } from 'koishi-plugin-chatluna/services/chat'
import {
    getModelMaxContextSize,
    isEmbeddingModel,
    isNonLLMModel,
    supportImageInput
} from '@chatluna/v1-shared-adapter'
import { RunnableConfig } from '@langchain/core/runnables'

export class OpenAIClient extends PlatformModelAndEmbeddingsClient {
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
                                : ModelType.llm,
                        capabilities: modelCapabilities,
                        maxTokens: contextSize ?? 4096
                    }) as ModelInfo
            )

            const filteredModels = rawModels.filter(
                (model) => !isNonLLMModel(model)
            )

            const supportToolCalling = (model: string) => {
                // const lower = model.toLowerCase()

                return {
                    capabilities: [
                        ModelCapabilities.ToolCall,
                        supportImageInput(model)
                            ? ModelCapabilities.ImageInput
                            : null
                    ].filter(Boolean)
                }
            }

            const formattedModels = filteredModels.map(
                (model) =>
                    ({
                        name: model,
                        type: isEmbeddingModel(model)
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
        model: string
    ): ChatLunaChatModel | ChatLunaBaseEmbeddings {
        const info = this._modelInfos[model]

        if (info == null) {
            throw new ChatLunaError(
                ChatLunaErrorCode.MODEL_NOT_FOUND,
                new Error(
                    `The model ${model} is not found in the models: ${JSON.stringify(Object.keys(this._modelInfos))}`
                )
            )
        }

        if (info.type === ModelType.llm) {
            return new ChatLunaChatModel({
                modelInfo: info,
                requester: this._requester,
                model,
                maxTokenLimit: Math.floor(
                    (info.maxTokens || 100_000) * this._config.maxContextRatio
                ),
                modelMaxContextSize: getModelMaxContextSize(info),
                frequencyPenalty: this._config.frequencyPenalty,
                presencePenalty: this._config.presencePenalty,
                timeout: this._config.timeout,
                temperature: this._config.temperature,
                maxRetries: this._config.maxRetries,
                llmType: 'openai',
                isThinkModel:
                    model.includes('reasoner') ||
                    model.includes('r1') ||
                    model.includes('thinking')
            })
        }

        return new ChatLunaEmbeddings({
            client: this._requester,
            model,
            maxRetries: this._config.maxRetries
        })
    }
}
