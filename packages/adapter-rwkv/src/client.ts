import { PlatformModelAndEmbeddingsClient } from 'koishi-plugin-chatluna/llm-core/platform/client'
import { ClientConfig } from 'koishi-plugin-chatluna/llm-core/platform/config'
import {
    ChatLunaBaseEmbeddings,
    ChatLunaChatModel,
    ChatLunaEmbeddings
} from 'koishi-plugin-chatluna/llm-core/platform/model'
import {
    ModelInfo,
    ModelType
} from 'koishi-plugin-chatluna/llm-core/platform/types'
import { Context } from 'koishi'
import { Config } from '.'
import {
    ChatLunaError,
    ChatLunaErrorCode
} from 'koishi-plugin-chatluna/utils/error'
import { RWKVRequester } from './requester'
import { ChatLunaPlugin } from 'koishi-plugin-chatluna/services/chat'
import { getModelMaxContextSize } from '@chatluna/v1-shared-adapter'

export class RWKVClient extends PlatformModelAndEmbeddingsClient<ClientConfig> {
    platform = 'rwkv'

    private _requester: RWKVRequester

    constructor(
        ctx: Context,
        private _config: Config,
        public plugin: ChatLunaPlugin
    ) {
        super(ctx, plugin.platformConfigPool)

        this._requester = new RWKVRequester(
            ctx,
            plugin.platformConfigPool,
            _config,
            plugin
        )
    }

    async refreshModels(): Promise<ModelInfo[]> {
        try {
            const rawModels = await this._requester.getModels()

            return rawModels
                .map((model) => {
                    return {
                        name: model,
                        type: ModelType.llm,
                        capabilities: []
                    } as ModelInfo
                })
                .concat([
                    {
                        name: 'rwkv-embeddings',
                        type: ModelType.embeddings,
                        capabilities: []
                    } as ModelInfo
                ])
        } catch (e) {
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
                llmType: 'rwkv'
            })
        }

        return new ChatLunaEmbeddings({
            client: this._requester,
            maxRetries: this._config.maxRetries
        })
    }
}
