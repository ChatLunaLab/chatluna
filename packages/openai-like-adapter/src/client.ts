import { Context } from 'koishi'
import { PlatformModelAndEmbeddingsClient } from 'koishi-plugin-chatluna/lib/llm-core/platform/client'
import { ClientConfig } from 'koishi-plugin-chatluna/lib/llm-core/platform/config'
import {
    ChatHubBaseEmbeddings,
    ChatLunaChatModel,
    ChatLunaEmbeddings
} from 'koishi-plugin-chatluna/lib/llm-core/platform/model'
import {
    ModelInfo,
    ModelType
} from 'koishi-plugin-chatluna/lib/llm-core/platform/types'
import {
    ChatLunaError,
    ChatLunaErrorCode
} from 'koishi-plugin-chatluna/lib/utils/error'
import { Config } from '.'
import { OpenAIRequester } from './requester'

export class OpenAIClient extends PlatformModelAndEmbeddingsClient {
    platform = 'openai'

    private _requester: OpenAIRequester

    private _models: Record<string, ModelInfo>

    constructor(
        ctx: Context,
        private _config: Config,
        clientConfig: ClientConfig
    ) {
        super(ctx, clientConfig)
        this.platform = _config.platform
        this._requester = new OpenAIRequester(clientConfig)
    }

    async init(): Promise<void> {
        await this.getModels()
    }

    async refreshModels(): Promise<ModelInfo[]> {
        try {
            const rawModels = this._config.pullModels
                ? await this._requester.getModels()
                : []

            const additionalModels = this._config.additionalModels.map(
                ([model, llmType, token]) => {
                    return {
                        name: model,
                        type:
                            llmType === 'Embeddings 嵌入模型'
                                ? ModelType.embeddings
                                : ModelType.llm,
                        functionCall: llmType === 'LLM 大语言模型（函数调用）',
                        maxTokens: token ?? 4096
                    } as ModelInfo
                }
            )

            return rawModels
                .filter(
                    (model) =>
                        !(
                            model.includes('whisper') ||
                            model.includes('tts') ||
                            model.includes('dall-e') ||
                            model.includes('image')
                        )
                )
                .map((model) => {
                    return {
                        name: model,
                        type: model.includes('text-embedding')
                            ? ModelType.embeddings
                            : ModelType.llm,
                        functionCall: true,
                        supportMode: ['all']
                    } as ModelInfo
                })
                .concat(additionalModels)
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
                maxTokens: this._config.maxTokens,
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
            maxRetries: this._config.maxRetries
        })
    }
}
