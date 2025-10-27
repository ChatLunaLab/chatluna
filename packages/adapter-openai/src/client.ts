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
import { Config, logger as pluginLogger } from '.'
import { OpenAIRequester } from './requester'
import { ChatLunaPlugin } from 'koishi-plugin-chatluna/services/chat'
import {
    getModelMaxContextSize,
    supportImageInput
} from '@chatluna/v1-shared-adapter'
import { RunnableConfig } from '@langchain/core/runnables'

export class OpenAIClient extends PlatformModelAndEmbeddingsClient<ClientConfig> {
    platform = 'openai'

    private _requester: OpenAIRequester

    get logger() {
        return pluginLogger
    }

    constructor(
        ctx: Context,
        private _config: Config,
        public plugin: ChatLunaPlugin
    ) {
        super(ctx, plugin.platformConfigPool)

        this._requester = new OpenAIRequester(
            ctx,
            plugin.platformConfigPool,
            _config,
            plugin
        )
    }

    async refreshModels(config?: RunnableConfig): Promise<ModelInfo[]> {
        try {
            const rawModels = await this._requester.getModels(config)

            return rawModels
                .filter(
                    (model) =>
                        model.includes('gpt') ||
                        model.includes('text-embedding') ||
                        model.includes('o1') ||
                        model.includes('o3') ||
                        model.includes('o4')
                )
                .filter(
                    (model) =>
                        !(
                            model.includes('instruct') ||
                            [
                                'whisper',
                                'tts',
                                'dall-e',
                                'audio',
                                'realtime'
                            ].some((keyword) => model.includes(keyword))
                        )
                )
                .map((model) => {
                    return {
                        name: model,
                        type: model.includes('embedding')
                            ? ModelType.embeddings
                            : ModelType.llm,
                        capabilities: [
                            ModelCapabilities.ToolCall,
                            supportImageInput(model)
                                ? ModelCapabilities.ImageInput
                                : undefined
                        ].filter(Boolean)
                    } as ModelInfo
                })
        } catch (e) {
            if (e instanceof ChatLunaError) {
                throw e
            }
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
                llmType: 'openai'
            })
        }

        return new ChatLunaEmbeddings({
            client: this._requester,
            model,
            batchSize: 256,
            maxRetries: this._config.maxRetries
        })
    }
}
