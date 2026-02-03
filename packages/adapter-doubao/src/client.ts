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
import { Config } from '.'
import { DoubaoRequester } from './requester'
import { ChatLunaPlugin } from 'koishi-plugin-chatluna/services/chat'
import { expandReasoningEffortModelVariants } from '@chatluna/v1-shared-adapter'

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
            ['doubao-seed-1-8-251228', 256000],
            ['doubao-seed-1-6-flash-250715', 256000],
            ['doubao-seed-1-6-251015', 256000],
            ['doubao-seed-1-6-lite-251015', 256000],
            ['doubao-seed-1-6-flash-250828', 256000],
            ['doubao-1.5-vision-pro-250328', 128000],
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
            'doubao-seed-1-8-251228'
        ]

        const imageInputSupportModels = [
            'doubao-seed-1-6',
            'vision',
            'doubao-seed-1-8'
        ]

        const expandedModels: [string, number | undefined][] = []
        const seen = new Set<string>()

        const push = (model: string, token?: number) => {
            if (seen.has(model)) return
            seen.add(model)
            expandedModels.push([model, token])
        }

        for (const [model, token] of rawModels) {
            push(model, token)

            if (!reasoningEffortModels.includes(model)) continue

            for (const variant of expandReasoningEffortModelVariants(model)) {
                push(variant, token)
            }
        }

        return expandedModels.map(([model, token]) => {
            return {
                name: model,
                type: model.includes('embedding')
                    ? ModelType.embeddings
                    : ModelType.llm,
                maxTokens: token,
                capabilities: [
                    unsupportedFunctionCallModels.includes(model)
                        ? undefined
                        : ModelCapabilities.ToolCall,
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
            client: this._requester,
            model,
            batchSize: 256,
            maxRetries: this._config.maxRetries
        })
    }
}
