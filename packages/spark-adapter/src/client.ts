import { PlatformModelClient } from '@dingyi222666/koishi-plugin-chathub/lib/llm-core/platform/client'
import { ChatHubChatModel } from '@dingyi222666/koishi-plugin-chathub/lib/llm-core/platform/model'
import {
    ModelInfo,
    ModelType
} from '@dingyi222666/koishi-plugin-chathub/lib/llm-core/platform/types'
import { Context } from 'koishi'
import { Config } from '.'
import {
    ChatHubError,
    ChatHubErrorCode
} from '@dingyi222666/koishi-plugin-chathub/lib/utils/error'
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
                type: ModelType.llm,
                supportChatMode: (mode) => mode.includes('chat')
            }
        })
    }

    protected _createModel(model: string): ChatHubChatModel {
        const info = this._models[model]

        if (info == null) {
            throw new ChatHubError(ChatHubErrorCode.MODEL_NOT_FOUND)
        }

        return new ChatHubChatModel({
            requester: this._requester,
            model,
            maxTokens: this._config.maxTokens,
            timeout: this._config.timeout,
            temperature: this._config.temperature,
            maxRetries: this._config.maxRetries,
            llmType: 'spark'
        })
    }
}
