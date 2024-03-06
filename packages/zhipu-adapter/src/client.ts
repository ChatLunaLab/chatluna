import { PlatformModelAndEmbeddingsClient } from 'koishi-plugin-chatluna/src/llm-core/platform/client'
import {
    ChatLunaChatModel,
    ChatLunaEmbeddings
} from 'koishi-plugin-chatluna/src/llm-core/platform/model'
import {
    ModelInfo,
    ModelType
} from 'koishi-plugin-chatluna/src/llm-core/platform/types'
import { Context } from 'koishi'
import { Config } from '.'
import {
    ChatLunaError,
    ChatLunaErrorCode
} from 'koishi-plugin-chatluna/src/utils/error'
import { ZhipuRequester } from './requester'
import { ZhipuClientConfig } from './types'

export class ZhipuClient extends PlatformModelAndEmbeddingsClient<ZhipuClientConfig> {
    platform = 'zhipu'

    private _requester: ZhipuRequester

    private _models: Record<string, ModelInfo>

    constructor(
        ctx: Context,
        private _config: Config,
        clientConfig: ZhipuClientConfig
    ) {
        super(ctx, clientConfig)

        this._requester = new ZhipuRequester(clientConfig)
    }

    async init(): Promise<void> {
        await this.getModels()
    }

    async refreshModels(): Promise<ModelInfo[]> {
        const rawModels = ['GLM-4V', 'GLM-4', 'GLM-3-Turbo', 'Embedding-2']

        return rawModels.map((model) => {
            return {
                name: model,
                type: model.includes('Embedding')
                    ? ModelType.embeddings
                    : ModelType.llm,
                supportMode: ['all'],
                // 128k
                maxTokens: model.includes('GLM-4') ? 128000 : 8192
            }
        })
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

        return models
    }

    protected _createModel(
        model: string
    ): ChatLunaChatModel | ChatLunaEmbeddings {
        const info = this._models[model]

        if (info == null) {
            throw new ChatLunaError(ChatLunaErrorCode.MODEL_NOT_FOUND)
        }

        if (info.type === ModelType.embeddings) {
            return new ChatLunaEmbeddings({
                client: this._requester,
                maxRetries: this._config.maxRetries
            })
        }

        return new ChatLunaChatModel({
            modelInfo: info,
            requester: this._requester,
            model: model.toLocaleLowerCase(),
            modelMaxContextSize: info.maxTokens,
            maxTokens: this._config.maxTokens,
            frequencyPenalty: this._config.frequencyPenalty,
            presencePenalty: this._config.presencePenalty,
            timeout: this._config.timeout,
            temperature: this._config.temperature,
            maxRetries: this._config.maxRetries,
            llmType: 'zhipu'
        })
    }
}
