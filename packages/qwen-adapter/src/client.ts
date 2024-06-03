import { Context } from 'koishi'
import { PlatformModelAndEmbeddingsClient } from 'koishi-plugin-chatluna/lib/llm-core/platform/client'
import { ClientConfig } from 'koishi-plugin-chatluna/lib/llm-core/platform/config'
import {
    ChatHubBaseEmbeddings,
    ChatLunaChatModel,
    ChatLunaEmbeddings
} from 'koishi-plugin-chatluna/lib/llm-core/platform/model'
import {
    ModelInfo,
    ModelType
} from 'koishi-plugin-chatluna/lib/llm-core/platform/types'
import {
    ChatLunaError,
    ChatLunaErrorCode
} from 'koishi-plugin-chatluna/lib/utils/error'
import { Config } from '.'
import { QWenRequester } from './requester'

export class QWenClient extends PlatformModelAndEmbeddingsClient<ClientConfig> {
    platform = 'qwen'

    private _requester: QWenRequester

    private _models: Record<string, ModelInfo>

    constructor(
        ctx: Context,
        private _config: Config,
        clientConfig: ClientConfig
    ) {
        super(ctx, clientConfig)

        this._requester = new QWenRequester(clientConfig, _config)
    }

    async init(): Promise<void> {
        await this.getModels()
    }

    async refreshModels(): Promise<ModelInfo[]> {
        const rawModels: [string, number | undefined][] = [
            ['qwen-turbo', 6000],
            ['qwen-plus', 30000],
            ['qwen-max', 6000],
            ['qwen-max-longcontext', 30000],
            ['qwen-max-0428', 6000],
            ['text-embedding-v1', undefined]
        ]

        return rawModels.map((model) => {
            return {
                name: model[0],
                type: model[1] != null ? ModelType.llm : ModelType.embeddings,
                maxTokens: model[1],
                functionCall: true,
                supportMode: ['all']
            }
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
                modelMaxContextSize: info.maxTokens,
                maxTokens: this._config.maxTokens,
                timeout: this._config.timeout,
                temperature: this._config.temperature,
                maxRetries: this._config.maxRetries,
                llmType: 'qwen'
            })
        }

        return new ChatLunaEmbeddings({
            client: this._requester,
            model: info.name,
            maxRetries: this._config.maxRetries
        })
    }
}
