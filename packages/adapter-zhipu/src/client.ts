import { Context } from 'koishi'
import { PlatformModelAndEmbeddingsClient } from 'koishi-plugin-chatluna/llm-core/platform/client'
import { ClientConfig } from 'koishi-plugin-chatluna/llm-core/platform/config'
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
import { Config } from './index'
import { ZhipuRequester } from './requester'
import { ChatLunaPlugin } from 'koishi-plugin-chatluna/services/chat'
import { logger as pluginLogger } from '.'
import { supportImageInput } from '@chatluna/v1-shared-adapter'

export class ZhipuClient extends PlatformModelAndEmbeddingsClient<ClientConfig> {
    platform = 'zhipu'

    private _requester: ZhipuRequester

    get logger() {
        return pluginLogger
    }

    constructor(
        ctx: Context,
        private _config: Config,
        public plugin: ChatLunaPlugin
    ) {
        super(ctx, plugin.platformConfigPool)

        this._requester = new ZhipuRequester(
            ctx,
            plugin.platformConfigPool,
            _config,
            plugin
        )
    }

    async init(): Promise<void> {
        await this.getModels()
    }

    async refreshModels(): Promise<ModelInfo[]> {
        const rawModels = [
            ['GLM-4-Plus', 128000],
            ['GLM-4-0520', 128000],
            ['GLM-4-Long', 1024000],
            ['GLM-4-AirX', 8192],
            ['GLM-4-Air', 128000],
            ['GLM-4-FlashX', 128000],
            ['GLM-4-FlashX-250414', 128000],
            ['GLM-4-Flash', 128000],
            ['GLM-4V', 2048],
            ['GLM-4V-Plus-0111', 16000],
            ['GLM-4V-Flash', 8192],
            ['GLM-Z1-Air', 128000],
            ['GLM-Z1-AirX', 32000],
            ['GLM-Z1-FlashX', 128000],
            ['GLM-Z1-Flash', 128000],
            ['GLM-4.1V-Thinking-Flash', 64000],
            ['GLM-4.1V-Thinking-FlashX', 64000],
            ['GLM-4.5', 128000],
            ['GLM-4.5X', 128000],
            ['GLM-4.5-Air', 128000],
            ['GLM-4.5-AirX', 128000],
            ['GLM-4.5-Flash', 128000],
            ['GLM-4.5V', 128000],
            ['GLM-4.6', 200_000]
            //   ['GLM-4-AllTools', 128000]
        ] as [string, number][]

        const embeddings = ['embedding-2', 'embedding-3']

        return rawModels
            .map(([model, maxTokens]) => {
                return {
                    name: model,
                    type: ModelType.llm,
                    capabilities: [
                        model !== 'GLM-4V' && ModelCapabilities.ToolCall,
                        supportImageInput(model) && ModelCapabilities.ImageInput
                    ].filter(Boolean),
                    maxTokens
                } as ModelInfo
            })
            .concat(
                embeddings.map((model) => {
                    return {
                        name: model,
                        type: ModelType.embeddings,
                        capabilities: [],
                        maxTokens: 8192
                    } satisfies ModelInfo
                })
            )
    }

    protected _createModel(
        model: string
    ): ChatLunaChatModel | ChatLunaBaseEmbeddings {
        const info = this._modelInfos[model]

        if (info == null) {
            throw new ChatLunaError(ChatLunaErrorCode.MODEL_NOT_FOUND)
        }

        if (info.type === ModelType.embeddings) {
            return new ChatLunaEmbeddings({
                client: this._requester,
                model,
                maxRetries: this._config.maxRetries
            })
        }

        const modelMaxContextSize = info.maxTokens
        return new ChatLunaChatModel({
            modelInfo: info,
            requester: this._requester,
            model: model.toLocaleLowerCase(),
            modelMaxContextSize,
            maxTokenLimit: Math.floor(
                (info.maxTokens || modelMaxContextSize || 128_000) *
                    this._config.maxContextRatio
            ),
            frequencyPenalty: this._config.frequencyPenalty,
            presencePenalty: this._config.presencePenalty,
            timeout: this._config.timeout,
            temperature: this._config.temperature,
            maxRetries: this._config.maxRetries,
            llmType: 'zhipu'
        })
    }
}
