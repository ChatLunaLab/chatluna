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
import { DeepseekRequester } from './requester'
import { ChatLunaPlugin } from 'koishi-plugin-chatluna/services/chat'
import { Config, logger as pluginLogger } from '.'
import {
    getOpenAIFileHandlingConfig,
    supportImageInput
} from '@chatluna/v1-shared-adapter'
import { RunnableConfig } from '@langchain/core/runnables'

import type { ModelUsageReporter } from 'koishi-plugin-chatluna/llm-core/platform/usage'

export class DeepseekClient extends PlatformModelAndEmbeddingsClient<ClientConfig> {
    platform = 'deepseek'

    private _requester: DeepseekRequester

    get logger() {
        return pluginLogger
    }

    constructor(
        ctx: Context,
        private _config: Config,
        public plugin: ChatLunaPlugin
    ) {
        super(ctx, plugin.platformConfigPool)

        this._requester = new DeepseekRequester(
            ctx,
            plugin.platformConfigPool,
            _config,
            plugin
        )
    }

    async refreshModels(config?: RunnableConfig): Promise<ModelInfo[]> {
        try {
            const rawModels = await this._requester.getModels(config)
            const models: string[] = []

            for (const model of rawModels) {
                models.push(model)

                if (!model.startsWith('deepseek-v4-')) continue
                if (model.endsWith('-thinking')) continue
                if (model.endsWith('-instant')) continue

                models.push(
                    `${model}-high-thinking`,
                    `${model}-max-thinking`,
                    `${model}-instant`
                )
            }

            return models
                .filter(
                    (model) =>
                        model.includes('deepseek') ||
                        model.includes('embedding')
                )

                .map((model) => {
                    const type = model.includes('deepseek')
                        ? ModelType.llm
                        : ModelType.embeddings

                    return {
                        name: model,
                        type,
                        maxTokens: 1_000_000,
                        capabilities:
                            type === ModelType.llm
                                ? [
                                      ModelCapabilities.ToolCall,
                                      supportImageInput(model)
                                          ? ModelCapabilities.ImageInput
                                          : null
                                  ].filter(Boolean)
                                : []
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
        model: string,
        report: ModelUsageReporter
    ): ChatLunaChatModel | ChatLunaBaseEmbeddings {
        const info = this._modelInfos[model]

        if (info == null) {
            pluginLogger.warn(
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
                modelMaxContextSize: info.maxTokens,
                maxTokenLimit: Math.floor(
                    (info.maxTokens || 1_000_000) * this._config.maxContextRatio
                ),
                frequencyPenalty: this._config.frequencyPenalty,
                presencePenalty: this._config.presencePenalty,
                timeout: this._config.timeout,
                temperature: this._config.temperature,
                maxRetries: this._config.maxRetries,
                llmType: 'deepseek',
                fileHandlingConfig: getOpenAIFileHandlingConfig(model),
                isThinkModel:
                    model.includes('reasoner') ||
                    model.includes('thinking') ||
                    (model.startsWith('deepseek-v4-') &&
                        !model.endsWith('-instant'))
            })
        }

        return new ChatLunaEmbeddings({
            usageReporter: report,
            client: this._requester,
            model,
            maxRetries: this._config.maxRetries
        })
    }
}
