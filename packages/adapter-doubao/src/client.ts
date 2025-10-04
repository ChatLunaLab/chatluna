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
            ['doubao-seed-1-6-flash-250715', 256000],
            ['doubao-seed-1-6-thinking-250715', 256000],
            ['doubao-seed-1-6-250615', 256000],
            ['doubao-seed-1-6-250615-non-thinking', 256000],
            ['doubao-seed-1-6-250615-thinking', 256000],
            ['doubao-seed-1-6-vision-250815', 256000],
            ['doubao-1.5-vision-pro-250328', 128000],
            ['deepseek-v3-1-250821', 128000],
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

        const imageInputSupportModels = ['doubao-seed-1-6', 'vision']

        return rawModels.map(([model, token]) => {
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
