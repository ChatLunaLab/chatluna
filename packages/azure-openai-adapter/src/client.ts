import { Context } from 'koishi'
import { PlatformModelAndEmbeddingsClient } from 'koishi-plugin-chatluna/llm-core/platform/client'
import {
    ChatHubBaseEmbeddings,
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
import { Config } from '.'
import { OpenAIRequester } from './requester'
import { ChatLunaPlugin } from 'koishi-plugin-chatluna/services/chat'
import { AzureOpenAIClientConfig } from './types'

export class OpenAIClient extends PlatformModelAndEmbeddingsClient<AzureOpenAIClientConfig> {
    platform = 'azure'

    private _requester: OpenAIRequester

    private _models: Record<string, ModelInfo>

    constructor(
        ctx: Context,
        private _config: Config,
        clientConfig: AzureOpenAIClientConfig,
        plugin: ChatLunaPlugin
    ) {
        super(ctx, clientConfig)

        this._requester = new OpenAIRequester(clientConfig, plugin)
    }

    async init(): Promise<void> {
        await this.getModels()
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
                        functionCall: llmType === 'LLM 大语言模型（函数调用）',
                        maxTokens: token ?? 4096,
                        supportMode: ['all']
                    } as ModelInfo
                }
            )
        } catch (e) {
            throw new ChatLunaError(ChatLunaErrorCode.MODEL_INIT_ERROR, e)
        }
    }

    async getModels(): Promise<ModelInfo[]> {
        if (this._models) {
            return Object.values(this._models)
        }

        const models = await this.refreshModels()

        this._models = {}

        for (const model of models) {
            this._models[model.name] = model
        }
    }

    protected _createModel(
        model: string
    ): ChatLunaChatModel | ChatHubBaseEmbeddings {
        const info = this._models[model]

        if (info == null) {
            throw new ChatLunaError(ChatLunaErrorCode.MODEL_NOT_FOUND)
        }

        if (info.type === ModelType.llm) {
            return new ChatLunaChatModel({
                modelInfo: info,
                requester: this._requester,
                model,
                maxTokenLimit: this._config.maxTokens,
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
