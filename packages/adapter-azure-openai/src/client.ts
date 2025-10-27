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
import { Config, logger as pluginLogger } from '.'
import { OpenAIRequester } from './requester'
import { ChatLunaPlugin } from 'koishi-plugin-chatluna/services/chat'
import { AzureOpenAIClientConfig } from './types'
import { getModelMaxContextSize } from '@chatluna/v1-shared-adapter'

export class OpenAIClient extends PlatformModelAndEmbeddingsClient<AzureOpenAIClientConfig> {
    platform = 'azure'

    private _requester: OpenAIRequester

    get logger() {
        return pluginLogger
    }

    get config(): AzureOpenAIClientConfig {
        return this.configPool.getConfig(true).value
    }

    constructor(
        ctx: Context,
        private _config: Config,
        public plugin: ChatLunaPlugin<AzureOpenAIClientConfig>
    ) {
        super(ctx, plugin.platformConfigPool)

        this._requester = new OpenAIRequester(
            ctx,
            plugin.platformConfigPool,
            _config,
            plugin
        )
    }

    async refreshModels(): Promise<ModelInfo[]> {
        try {
            return this._config.supportModels.map(
                ({ model, modelType: llmType, contextSize: token }) => {
                    return {
                        name: model,
                        type:
                            llmType === 'Embeddings 嵌入模型'
                                ? ModelType.embeddings
                                : ModelType.llm,
                        capabilities: [
                            ModelCapabilities.ImageInput,
                            llmType === 'LLM 大语言模型（函数调用）'
                                ? ModelCapabilities.ToolCall
                                : undefined,
                            model.includes('gpt-5') ||
                            model.includes('o1') ||
                            model.includes('o3') ||
                            model.includes('o4')
                                ? ModelCapabilities.Thinking
                                : undefined
                        ].filter(Boolean),
                        maxTokens: token ?? 100_000
                    } as ModelInfo
                }
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
            throw new ChatLunaError(ChatLunaErrorCode.MODEL_NOT_FOUND)
        }

        if (info.type === ModelType.llm) {
            const modelMaxContextSize = getModelMaxContextSize(info)
            return new ChatLunaChatModel({
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
                llmType: 'openai'
            })
        }

        return new ChatLunaEmbeddings({
            client: this._requester,
            model,
            maxRetries: this._config.maxRetries
        })
    }
}
