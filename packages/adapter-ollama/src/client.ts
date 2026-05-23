import { Context } from 'koishi'
import { PlatformModelAndEmbeddingsClient } from 'koishi-plugin-chatluna/llm-core/platform/client'
import { ClientConfig } from 'koishi-plugin-chatluna/llm-core/platform/config'
import {
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
import { Config, logger } from '.'
import { OllamaRequester } from './requester'
import { ChatLunaPlugin } from 'koishi-plugin-chatluna/services/chat'

import type { ModelUsageReporter } from 'koishi-plugin-chatluna/llm-core/platform/usage'

export class OllamaClient extends PlatformModelAndEmbeddingsClient<ClientConfig> {
    platform = 'ollama'

    private _requester: OllamaRequester

    constructor(
        ctx: Context,
        private _config: Config,
        public plugin: ChatLunaPlugin<ClientConfig, Config>
    ) {
        super(ctx, plugin.platformConfigPool)

        this._requester = new OllamaRequester(
            ctx,
            plugin.platformConfigPool,
            plugin
        )
    }

    async refreshModels(): Promise<ModelInfo[]> {
        try {
            const rawModels = await this._requester.getModels()

            return rawModels.map((model) => {
                return {
                    name: model,
                    type:
                        model.includes('embed') ||
                        model.includes('all-minilm') ||
                        model.includes('bge') ||
                        model.includes('paraphrase-multilingual')
                            ? ModelType.embeddings
                            : ModelType.llm,
                    capabilities: [
                        this._config.supportImageModels.includes(model)
                            ? ModelCapabilities.ImageInput
                            : undefined
                    ].filter(Boolean),
                    maxTokens: ((model: string) => {
                        if (model.startsWith('llama3')) {
                            return 32000
                        }

                        return 128000
                    })(model)
                }
            })
        } catch (e) {
            throw new ChatLunaError(ChatLunaErrorCode.MODEL_INIT_ERROR, e)
        }
    }

    protected _createModel(
        model: string,
        report: ModelUsageReporter
    ): ChatLunaChatModel | ChatLunaEmbeddings {
        const info = this._modelInfos[model]

        if (info == null) {
            logger.warn(
                `Model ${model} not found`,
                JSON.stringify(this._modelInfos)
            )
            throw new ChatLunaError(ChatLunaErrorCode.MODEL_NOT_FOUND)
        }

        if (info.type === ModelType.llm) {
            return new ChatLunaChatModel({
                usageReporter: report,
                modelInfo: info,
                requester: this._requester,
                model,
                maxTokenLimit: Math.floor(
                    (info.maxTokens || 100_000) * this._config.maxContextRatio
                ),
                modelMaxContextSize: info.maxTokens,
                frequencyPenalty: this._config.frequencyPenalty,
                presencePenalty: this._config.presencePenalty,
                timeout: this._config.timeout,
                temperature: this._config.temperature,
                maxRetries: this._config.maxRetries,
                llmType: 'ollama'
            })
        }

        return new ChatLunaEmbeddings({
            usageReporter: report,
            model,
            client: this._requester,
            maxRetries: this._config.maxRetries
        })
    }
}
