import { PlatformModelClient } from 'koishi-plugin-chatluna/lib/llm-core/platform/client'
import { ChatLunaChatModel } from 'koishi-plugin-chatluna/lib/llm-core/platform/model'
import {
    ModelInfo,
    ModelType
} from 'koishi-plugin-chatluna/lib/llm-core/platform/types'
import { Context } from 'koishi'
import { Config } from '.'
import {
    ChatLunaError,
    ChatLunaErrorCode
} from 'koishi-plugin-chatluna/lib/utils/error'
import { SparkRequester } from './requester'
import { SparkClientConfig } from './types'

export class SparkClient extends PlatformModelClient<SparkClientConfig> {
    platform = 'spark'

    private _requester: SparkRequester

    private _models: Record<string, ModelInfo>

    constructor(
        ctx: Context,
        private _config: Config,
        clientConfig: SparkClientConfig
    ) {
        super(ctx, clientConfig)

        this._requester = new SparkRequester(ctx, clientConfig, _config)
    }

    async init(): Promise<void> {
        const models = await this.getModels()

        this._models = {}

        for (const model of models) {
            this._models[model.name] = model
        }
    }

    async getModels(): Promise<ModelInfo[]> {
        if (this._models) {
            return Object.values(this._models)
        }

        const rawModels = ['v1.5', 'v2', 'v3']

        return rawModels.map((model) => {
            return {
                name: model,
                maxTokens: model === 'v1.5' ? 4096 : 8192,
                type: ModelType.llm,
                supportChatMode: (mode) => true
            }
        })
    }

    protected _createModel(model: string): ChatLunaChatModel {
        const info = this._models[model]

        if (info == null) {
            throw new ChatLunaError(ChatLunaErrorCode.MODEL_NOT_FOUND)
        }

        return new ChatLunaChatModel({
            requester: this._requester,
            model,
            maxTokens: this._config.maxTokens,
            timeout: this._config.timeout,
            temperature: this._config.temperature,
            maxRetries: this._config.maxRetries,
            llmType: 'spark',
            modelMaxContextSize: info.maxTokens
        })
    }
}
