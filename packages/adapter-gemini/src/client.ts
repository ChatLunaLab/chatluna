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
import { GeminiModelInfo } from './types'

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
        const thinkingModel = ['gemini-2.5-pro', 'gemini-2.5-flash']
        const thinkingLevelModel = ['gemini-3-pro', 'gemini-3-flash']
        const imageResolutionModel = ['gemini-3-pro-image']

        const includesAny = (needles: readonly string[], haystack: string) =>
            needles.some((name) => haystack.includes(name))

        const pushExpanded = (
            out: ModelInfo[],
            base: ModelInfo,
            suffixes: readonly string[]
        ) => {
            for (const suffix of suffixes) {
                out.push({ ...base, name: base.name + suffix })
            }
            out.push(base)
        }

        const models: ModelInfo[] = []
        let rawModels: GeminiModelInfo[] = []

        try {
            rawModels = await this._requester.getModels(config)

            if (rawModels.length === 0) {
                throw new ChatLunaError(
                    ChatLunaErrorCode.MODEL_INIT_ERROR,
                    new Error('No model found')
                )
            }
        } catch (e) {
            if (e instanceof ChatLunaError) {
                throw e
            }
            throw new ChatLunaError(ChatLunaErrorCode.MODEL_INIT_ERROR, e)
        }

        for (const model of rawModels) {
            const modelNameLower = model.name.toLowerCase()

            const baseInfo = {
                name: model.name,
                maxTokens: model.inputTokenLimit,
                type: modelNameLower.includes('embedding')
                    ? ModelType.embeddings
                    : ModelType.llm,
                capabilities: modelNameLower.includes('embedding')
                    ? []
                    : [ModelCapabilities.ImageInput, ModelCapabilities.ToolCall]
            } satisfies ModelInfo

            const isImageResolution = includesAny(
                imageResolutionModel,
                modelNameLower
            )
            const isThinking =
                includesAny(thinkingModel, modelNameLower) &&
                !modelNameLower.includes('image')
            const isThinkingLevel =
                includesAny(thinkingLevelModel, modelNameLower) &&
                !modelNameLower.includes('image')

            if (isImageResolution) {
                pushExpanded(models, baseInfo, ['-2K', '-4K'])
                continue
            }

            if (isThinking) {
                if (modelNameLower.includes('-thinking')) {
                    models.push(baseInfo)
                } else {
                    pushExpanded(models, baseInfo, [
                        '-non-thinking',
                        '-thinking'
                    ])
                }
                continue
            }

            if (isThinkingLevel) {
                const suffixes = modelNameLower.includes('3-pro')
                    ? ['-low-thinking', '-high-thinking', '-minimal-thinking']
                    : [
                          '-low-thinking',
                          '-high-thinking',
                          '-minimal-thinking',
                          '-medium-thinking'
                      ]
                pushExpanded(models, baseInfo, suffixes)
                continue
            }

            models.push(baseInfo)
        }

        return models
    }

    protected _createModel(
        model: string
    ): ChatLunaChatModel | ChatLunaBaseEmbeddings {
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
