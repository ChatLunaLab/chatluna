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
import { HunyuanRequester } from './requester'
import { ChatLunaPlugin } from 'koishi-plugin-chatluna/services/chat'

export class HunyuanClient extends PlatformModelAndEmbeddingsClient<ClientConfig> {
    platform = 'hunyuan'

    private _requester: HunyuanRequester

    private _models: Record<string, ModelInfo>

    constructor(
        ctx: Context,
        private _config: Config,
        clientConfig: ClientConfig,
        plugin: ChatLunaPlugin
    ) {
        super(ctx, clientConfig)

        this._requester = new HunyuanRequester(clientConfig, _config, plugin)
    }

    async init(): Promise<void> {
        await this.getModels()
    }

    async refreshModels(): Promise<ModelInfo[]> {
        const rawModels: [string, number | undefined][] = [
            ['hunyuan-turbo', 28000],
            ['hunyuan-pro', 28000],
            ['hunyuan-standard', 28000],
            ['hunyuan-standard-256K', 250000],
            ['hunyuan-lite', 250000],
            ['hunyuan-role', 4000],
            ['hunyuan-functioncall', 28000],
            ['hunyuan-vision', 4000],
            ['hunyuan-embedding', 1024]
        ] as [string, number][]

        return rawModels.map(([model, token]) => {
            return {
                name: model,
                type: model.includes('embedding')
                    ? ModelType.embeddings
                    : ModelType.llm,
                maxTokens: token,
                functionCall: model.includes('functioncall'),
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
                modelMaxContextSize: info.maxTokens,
                maxTokenLimit: this._config.maxTokens,
                timeout: this._config.timeout,
                temperature: this._config.temperature,
                maxRetries: this._config.maxRetries,
                llmType: 'hunyuan'
            })
        }

        return new ChatLunaEmbeddings({
            client: this._requester,
            model: info.name,
            maxRetries: this._config.maxRetries
        })
    }
}
