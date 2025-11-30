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
import { Config, logger } from '.'
import { GeminiRequester } from './requester'
import { ChatLunaPlugin } from 'koishi-plugin-chatluna/services/chat'
import { RunnableConfig } from '@langchain/core/runnables'

export class GeminiClient extends PlatformModelAndEmbeddingsClient<ClientConfig> {
    platform = 'gemini'

    private _requester: GeminiRequester

    get logger() {
        return logger
    }

    constructor(
        ctx: Context,
        private _config: Config,
        public plugin: ChatLunaPlugin<ClientConfig, Config>
    ) {
        super(ctx, plugin.platformConfigPool)

        this.platform = this._config.platform

        this._requester = new GeminiRequester(
            ctx,
            plugin.platformConfigPool,
            this._config,
            plugin
        )
    }

    async refreshModels(config?: RunnableConfig): Promise<ModelInfo[]> {
        try {
            const rawModels = await this._requester.getModels(config)

            if (!rawModels.length) {
                throw new ChatLunaError(
                    ChatLunaErrorCode.MODEL_INIT_ERROR,
                    new Error('No model found')
                )
            }

            const models: ModelInfo[] = []

            for (const model of rawModels) {
                const info = {
                    name: model.name,
                    maxTokens: model.inputTokenLimit,
                    type: model.name.includes('embedding')
                        ? ModelType.embeddings
                        : ModelType.llm,
                    capabilities: [
                        ModelCapabilities.ImageInput,
                        ModelCapabilities.ToolCall
                    ]
                } satisfies ModelInfo

                const thinkingModel = ['gemini-2.5-pro', 'gemini-2.5-flash']

                const thinkingLevelModel = ['gemini-3.0-pro']

                const imageResolutionModel = ['gemini-3.0-pro-image']

                if (
                    thinkingModel.some(
                        (name) =>
                            model.name.toLowerCase().includes(name) &&
                            !model.name.toLowerCase().includes('image')
                    )
                ) {
                    if (!model.name.includes('-thinking')) {
                        models.push(
                            { ...info, name: model.name + '-non-thinking' },
                            { ...info, name: model.name + '-thinking' },
                            info
                        )
                    } else {
                        models.push(info)
                    }
                } else if (
                    thinkingLevelModel.some(
                        (name) =>
                            model.name.toLowerCase().includes(name) &&
                            !model.name.toLowerCase().includes('image')
                    )
                ) {
                    models.push(
                        { ...info, name: model.name + '-low-thinking' },
                        info
                    )
                } else if (
                    imageResolutionModel.some((name) =>
                        model.name.toLowerCase().includes(name)
                    )
                ) {
                    models.push(
                        { ...info, name: model.name + '-2K' },
                        { ...info, name: model.name + '-4K' },
                        info
                    )
                } else {
                    models.push(info)
                }
            }

            return models
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
            return new ChatLunaChatModel({
                modelInfo: info,
                requester: this._requester,
                model,
                modelMaxContextSize: info.maxTokens,
                maxTokenLimit: Math.floor(
                    (info.maxTokens || 100_000) * this._config.maxContextRatio
                ),
                timeout: this._config.timeout,
                temperature: this._config.temperature,
                maxRetries: this._config.maxRetries,
                llmType: this.platform
            })
        }

        return new ChatLunaEmbeddings({
            client: this._requester,
            model,
            maxRetries: this._config.maxRetries
        })
    }
}
