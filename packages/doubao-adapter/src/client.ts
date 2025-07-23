import { Context } from 'koishi'
import { PlatformModelAndEmbeddingsClient } from 'koishi-plugin-chatluna/llm-core/platform/client'
import { ClientConfig } from 'koishi-plugin-chatluna/llm-core/platform/config'
import {
    ChatHubBaseEmbeddings,
    ChatLunaChatModel,
    ChatLunaEmbeddings
} from 'koishi-plugin-chatluna/llm-core/platform/model'
import {
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

    private _models: Record<string, ModelInfo>

    constructor(
        ctx: Context,
        private _config: Config,
        clientConfig: ClientConfig,
        plugin: ChatLunaPlugin
    ) {
        super(ctx, clientConfig)

        this._requester = new DoubaoRequester(clientConfig, plugin)
    }

    async init(): Promise<void> {
        await this.getModels()
    }

    async refreshModels(): Promise<ModelInfo[]> {
        const rawModels: [string, number | undefined][] = [
            ['doubao-seed-1-6-flash-250615', 256000],
            ['doubao-seed-1-6-thinking-250715', 256000],
            ['doubao-seed-1-6-250615', 256000],
            ['doubao-seed-1-6-250615-non-thinking', 256000],
            ['doubao-seed-1-6-250615-thinking', 256000],
            ['doubao-1.5-vision-pro-250328', 128000],
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

        return rawModels.map(([model, token]) => {
            return {
                name: model,
                type: model.includes('embedding')
                    ? ModelType.embeddings
                    : ModelType.llm,
                maxTokens: token,
                functionCall: !unsupportedFunctionCallModels.includes(model),

                supportMode: ['all']
            } as ModelInfo
        })
    }

    async getModels(): Promise<ModelInfo[]> {
        if (this._models) {
            return Object.values(this._models)
        }

        const models = await this.refreshModels()

        this._models = {}

        for (const model of models) {
            this._models[model.name] = model
        }
    }

    protected _createModel(
        model: string
    ): ChatLunaChatModel | ChatHubBaseEmbeddings {
        const info = this._models[model]

        if (info == null) {
            throw new ChatLunaError(ChatLunaErrorCode.MODEL_NOT_FOUND)
        }

        if (info.type === ModelType.llm) {
            return new ChatLunaChatModel({
                modelInfo: info,
                requester: this._requester,
                model,
                maxTokenLimit: this._config.maxTokens,
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
