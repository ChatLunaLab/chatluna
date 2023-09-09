import { PlatformModelAndEmbeddingsClient } from '@dingyi222666/koishi-plugin-chathub/lib/llm-core/platform/client'
import { ClientConfig } from '@dingyi222666/koishi-plugin-chathub/lib/llm-core/platform/config'
import {
    ChatHubBaseEmbeddings,
    ChatHubChatModel,
    ChatHubEmbeddings
} from '@dingyi222666/koishi-plugin-chathub/lib/llm-core/platform/model'
import {
    ModelInfo,
    ModelType
} from '@dingyi222666/koishi-plugin-chathub/lib/llm-core/platform/types'
import { Context } from 'koishi'
import { Config } from '.'
import { ChatHubError, ChatHubErrorCode } from '@dingyi222666/koishi-plugin-chathub/lib/utils/error'
import { RWKVRequester } from './requester'

export class RWKVClient extends PlatformModelAndEmbeddingsClient<ClientConfig> {
    platform = 'rwkv'

    private _requester: RWKVRequester

    private _models: Record<string, ModelInfo>

    constructor(
        ctx: Context,
        private _config: Config,
        clientConfig: ClientConfig
    ) {
        super(ctx, clientConfig)

        this._requester = new RWKVRequester(clientConfig)
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
            const rawModels = await this._requester.getModels()

            return rawModels
                .map((model) => {
                    return {
                        name: model,
                        type: ModelType.llm,
                        supportChatMode: (mode: string) => {
                            return mode === 'chat'
                        }
                    }
                })
                .concat([
                    {
                        name: 'rwkv-embeddings',
                        type: ModelType.embeddings,
                        supportChatMode: () => false
                    }
                ])
        } catch (e) {
            throw new ChatHubError(ChatHubErrorCode.MODEL_INIT_ERROR, e)
        }
    }

    protected _createModel(model: string): ChatHubChatModel | ChatHubBaseEmbeddings {
        const info = this._models[model]

        if (info == null) {
            throw new ChatHubError(ChatHubErrorCode.MODEL_NOT_FOUND)
        }

        if (info.type === ModelType.llm) {
            return new ChatHubChatModel({
                requester: this._requester,
                model,
                maxTokens: this._config.maxTokens,
                frequencyPenalty: this._config.frequencyPenalty,
                presencePenalty: this._config.presencePenalty,
                timeout: this._config.timeout,
                temperature: this._config.temperature,
                maxRetries: this._config.maxRetries,
                llmType: 'rwkv'
            })
        }

        return new ChatHubEmbeddings({
            client: this._requester,
            maxRetries: this._config.maxRetries
        })
    }
}
