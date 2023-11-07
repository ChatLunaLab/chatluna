import { PlatformModelAndEmbeddingsClient } from 'koishi-plugin-chatluna/lib/llm-core/platform/client'
import { ClientConfig } from 'koishi-plugin-chatluna/lib/llm-core/platform/config'
import {
    ChatHubBaseEmbeddings,
    ChatHubChatModel,
    ChatHubEmbeddings
} from 'koishi-plugin-chatluna/lib/llm-core/platform/model'
import {
    ModelInfo,
    ModelType
} from 'koishi-plugin-chatluna/lib/llm-core/platform/types'
import { Context } from 'koishi'
import { Config } from '.'
import {
    ChatHubError,
    ChatHubErrorCode
} from 'koishi-plugin-chatluna/lib/utils/error'
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

        this._requester = new WenxinRequester(clientConfig)
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

        try {
            const rawModels = [
                'text-embedding',
                'ERNIE-Bot',
                'ERNIE-Bot-turbo',
                'ERNIE-Bot-4'
            ]

            return rawModels.map((model) => {
                return {
                    name: model,
                    type: model.includes('ERNIE')
                        ? ModelType.llm
                        : ModelType.embeddings,
                    supportChatMode: model.includes('ERNIE')
                        ? (_) => true
                        : undefined
                }
            })
        } catch (e) {
            throw new ChatHubError(ChatHubErrorCode.MODEL_INIT_ERROR, e)
        }
    }

    protected _createModel(
        model: string
    ): ChatHubChatModel | ChatHubBaseEmbeddings {
        const info = this._models[model]

        if (info == null) {
            throw new ChatHubError(ChatHubErrorCode.MODEL_NOT_FOUND)
        }

        if (info.type === ModelType.llm) {
            return new ChatHubChatModel({
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

        return new ChatHubEmbeddings({
            client: this._requester,
            maxRetries: this._config.maxRetries
        })
    }
}
