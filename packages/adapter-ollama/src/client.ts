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
import type { OllamaShowResponse } from './types'

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

            const models = await Promise.all(
                rawModels.map(async (model) => {
                    let show: OllamaShowResponse
                    try {
                        show = await this._requester.getModelDetails(model.name)
                    } catch (e) {
                        logger.warn(
                            `Failed to get model details for ${model.name}`,
                            e
                        )
                        show = { details: model.details }
                    }
                    const caps = (show.capabilities ?? []).map((cap) =>
                        cap.toLowerCase()
                    )
                    const families = [
                        show.details?.family,
                        ...(show.details?.families ?? [])
                    ]
                        .filter((family): family is string => family != null)
                        .map((family) => family.toLowerCase())
                    const name = model.name.toLowerCase()
                    const type =
                        caps.includes('embedding') ||
                        caps.includes('embeddings') ||
                        name.includes('embed') ||
                        name.includes('all-minilm') ||
                        name.includes('bge') ||
                        name.includes('paraphrase-multilingual') ||
                        families.some(
                            (family) =>
                                family.includes('embed') ||
                                family.includes('all-minilm') ||
                                family.includes('bge')
                        )
                            ? ModelType.embeddings
                            : ModelType.llm

                    let maxTokens = 0
                    const modelInfo = show.model_info ?? {}
                    for (const key of Object.keys(modelInfo)) {
                        const value = modelInfo[key]
                        if (
                            key.endsWith('.context_length') &&
                            typeof value === 'number'
                        ) {
                            maxTokens = value
                            break
                        }
                    }

                    if (maxTokens < 1 && show.parameters != null) {
                        const match = show.parameters.match(/^num_ctx\s+(\d+)/m)
                        if (match != null) {
                            maxTokens = Number(match[1])
                        }
                    }

                    if (maxTokens < 1) {
                        maxTokens = model.name.startsWith('llama3')
                            ? 32000
                            : 128000
                    }

                    return {
                        name: model.name,
                        type,
                        capabilities:
                            type === ModelType.llm
                                ? [
                                      caps.includes('vision') ||
                                      this._config.supportImageModels.includes(
                                          model.name
                                      )
                                          ? ModelCapabilities.ImageInput
                                          : undefined,
                                      caps.includes('tools') ||
                                      caps.includes('tool') ||
                                      caps.includes('tool_call') ||
                                      caps.includes('tool-calling') ||
                                      caps.includes('function_call') ||
                                      caps.includes('function_calling') ||
                                      caps.includes('function-calling')
                                          ? ModelCapabilities.ToolCall
                                          : undefined,
                                      caps.includes('thinking') ||
                                      caps.includes('think')
                                          ? ModelCapabilities.Thinking
                                          : undefined
                                  ].filter(Boolean)
                                : [],
                        maxTokens
                    } as ModelInfo
                })
            )

            const result = models.flatMap((model) => {
                if (
                    model.type !== ModelType.llm ||
                    model.name.includes('thinking') ||
                    !model.capabilities.includes(ModelCapabilities.Thinking)
                ) {
                    return [model]
                }

                return [
                    model,
                    ...[
                        'non-thinking',
                        'low-thinking',
                        'medium-thinking',
                        'high-thinking',
                        'max-thinking',
                        'thinking'
                    ].map((suffix) => ({
                        ...model,
                        name: `${model.name}-${suffix}`
                    }))
                ]
            })

            this._requester.setModels(result)

            return result
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
                llmType: 'ollama',
                isThinkModel: info.capabilities.includes(
                    ModelCapabilities.Thinking
                )
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
