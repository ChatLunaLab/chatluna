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
import { DoubaoRequester } from './requester'
import { ChatLunaPlugin } from 'koishi-plugin-chatluna/services/chat'
import { expandReasoningEffortModelVariants } from '@chatluna/v1-shared-adapter'

import type { ModelUsageReporter } from 'koishi-plugin-chatluna/llm-core/platform/usage'

export class DouBaoClient extends PlatformModelAndEmbeddingsClient<ClientConfig> {
    platform = 'doubao'

    private _requester: DoubaoRequester

    constructor(
        ctx: Context,
        private _config: Config,
        public plugin: ChatLunaPlugin
    ) {
        super(ctx, plugin.platformConfigPool)

        this._requester = new DoubaoRequester(
            ctx,
            plugin.platformConfigPool,
            _config,
            plugin
        )
    }

    async refreshModels(): Promise<ModelInfo[]> {
        const rawModels: [string, number | undefined][] = [
            ['doubao-seed-2-0-lite-260428', 256000],
            ['doubao-seed-2-0-mini-260428', 256000],
            ['doubao-seed-2-0-pro-260215', 256000],
            ['doubao-seed-2-1-pro', 256000],
            ['doubao-seed-2-1-turbo', 256000],
            ['doubao-seed-2-0-lite-260215', 256000],
            ['doubao-seed-2-0-mini-260215', 256000],
            ['doubao-seed-2-0-code-preview-260215', 256000],
            ['doubao-seed-1-8-251228', 256000],
            ['doubao-seed-1-6-flash-250715', 256000],
            ['doubao-seed-1-6-251015', 256000],
            ['doubao-seed-1-6-lite-251015', 256000],
            ['doubao-seed-1-6-flash-250828', 256000],
            ['doubao-1.5-vision-pro-250328', 128000],
            ['deepseek-v4-pro-260425', 1000000],
            ['deepseek-v4-flash-260425', 1000000],
            ['deepseek-v3-1-250821', 128000],
            ['deepseek-v3-2-251201', 128000],
            ['glm-4-7-251222', 200000],
            ['kimi-k2-thinking-251104', 256000],
            ['kimi-k2-250711', 128000],
            ['doubao-1.5-vision-lite-250315', 128000],
            ['doubao-1-5-thinking-vision-pro-250428', 128000],
            ['doubao-1-5-vision-pro-32k-250115', 32000],
            ['doubao-1-5-thinking-pro-250415', 128000],
            ['doubao-1-5-lite-32k-250115', 32000],
            ['doubao-1-5-lite-32k-250115', 32000],
            ['doubao-1-5-pro-256k-250115', 256000],
            ['deepseek-r1-250528', 128000],
            ['deepseek-v3-250324', 128000],
            ['doubao-embedding-large-text-250515', 2048],
            ['doubao-embedding-text-240715', 8192]
        ]

        const unsupportedFunctionCallModels = [
            'doubao-1.5-vision-pro-250328',
            'doubao-1.5-vision-lite-250315'
        ]

        const reasoningEffortModels = [
            'doubao-seed-1-6-lite-251015',
            'doubao-seed-1-6-251015',
            'doubao-seed-1-8-251228',
            'doubao-seed-2-0-lite-260428',
            'doubao-seed-2-0-mini-260428',
            'doubao-seed-2-0-pro-260215',
            'doubao-seed-2-0-lite-260215',
            'doubao-seed-2-0-mini-260215',
            'doubao-seed-2-0-code-preview-260215',
            'deepseek-v4-pro-260425',
            'deepseek-v4-flash-260425'
        ]

        const imageInputSupportModels = [
            'doubao-seed-1-6',
            'vision',
            'doubao-seed-1-8',
            'doubao-seed-2-0',
            'doubao-seed-2-1'
        ]

        const expandedModels = rawModels.flatMap(([model, token]) => {
            const result: [string, number | undefined][] = [[model, token]]
            if (reasoningEffortModels.includes(model)) {
                for (const variant of expandReasoningEffortModelVariants(
                    model,
                    [
                        'non-thinking',
                        'minimal-thinking',
                        'low-thinking',
                        'medium-thinking',
                        'high-thinking'
                    ]
                )) {
                    result.push([variant, token])
                }
            }
            return result
        })

        return expandedModels.map(([model, token]) => {
            const type = model.includes('embedding')
                ? ModelType.embeddings
                : ModelType.llm

            return {
                name: model,
                type,
                maxTokens: token,
                capabilities: [
                    type === ModelType.llm &&
                        !unsupportedFunctionCallModels.includes(model) &&
                        ModelCapabilities.ToolCall,
                    imageInputSupportModels.some((pattern) =>
                        model.match(pattern)
                    )
                        ? ModelCapabilities.ImageInput
                        : undefined
                ].filter(Boolean)
            } as ModelInfo
        })
    }

    protected _createModel(
        model: string,
        report: ModelUsageReporter
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
                usageReporter: report,
                modelInfo: info,
                requester: this._requester,
                model,
                modelMaxContextSize: info.maxTokens,
                maxTokenLimit: Math.floor(
                    (info.maxTokens || 100_000) * this._config.maxContextRatio
                ),
                frequencyPenalty: this._config.frequencyPenalty,
                presencePenalty: this._config.presencePenalty,
                timeout: this._config.timeout,
                temperature: this._config.temperature,
                maxRetries: this._config.maxRetries,
                llmType: 'openai'
            })
        }

        return new ChatLunaEmbeddings({
            usageReporter: report,
            client: this._requester,
            model,
            batchSize: 256,
            maxRetries: this._config.maxRetries
        })
    }
}
