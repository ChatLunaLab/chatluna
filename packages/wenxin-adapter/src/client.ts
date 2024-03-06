import { PlatformModelAndEmbeddingsClient } from 'koishi-plugin-chatluna/src/llm-core/platform/client'
import { ClientConfig } from 'koishi-plugin-chatluna/src/llm-core/platform/config'
import {
    ChatHubBaseEmbeddings,
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
import { WenxinRequester } from './requester'

export class WenxinClient extends PlatformModelAndEmbeddingsClient<ClientConfig> {
    platform = 'wenxin'

    private _requester: WenxinRequester

    private _models: Record<string, ModelInfo>

    constructor(
        ctx: Context,
        private _config: Config,
        clientConfig: ClientConfig
    ) {
        super(ctx, clientConfig)

        this._requester = new WenxinRequester(clientConfig, _config)
    }

    async init(): Promise<void> {
        await this.getModels()
    }

    async refreshModels(): Promise<ModelInfo[]> {
        const rawModels = [
            'text-embedding',
            'ERNIE-Bot',
            'ERNIE-Bot-8K',
            'ERNIE-3.5-4K-0205',
            'ERNIE-3.5-8K-0205',
            'ERNIE-Bot-turbo',
            'ERNIE-Bot-4'
        ]

        return rawModels.map((model) => {
            return {
                name: model,
                type: model.includes('ERNIE')
                    ? ModelType.llm
                    : ModelType.embeddings,
                functionCall: model === 'ERNIE-Bot',
                supportMode: ['all'],
                maxTokens:
                    model.includes('8K') || model.includes('Bot-4')
                        ? 8072
                        : 4096
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
                modelMaxContextSize: 8000,
                maxTokens: this._config.maxTokens,
                frequencyPenalty: this._config.frequencyPenalty,
                presencePenalty: this._config.presencePenalty,
                timeout: this._config.timeout,
                temperature: this._config.temperature,
                maxRetries: this._config.maxRetries,
                llmType: 'wenxin'
            })
        }

        return new ChatLunaEmbeddings({
            client: this._requester,
            maxRetries: this._config.maxRetries
        })
    }
}
