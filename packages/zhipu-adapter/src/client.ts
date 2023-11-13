import { PlatformModelClient } from 'koishi-plugin-chatluna/lib/llm-core/platform/client'
import { ClientConfig } from 'koishi-plugin-chatluna/lib/llm-core/platform/config'
import { ChatLunaChatModel } from 'koishi-plugin-chatluna/lib/llm-core/platform/model'
import {
    ModelInfo,
    ModelType
} from 'koishi-plugin-chatluna/lib/llm-core/platform/types'
import { Context } from 'koishi'
import { Config } from '.'
import {
    ChatLunaError,
    ChatLunaErrorCode
} from 'koishi-plugin-chatluna/lib/utils/error'
import { ZhipuRequester } from './requester'

export class ZhipuClient extends PlatformModelClient<ClientConfig> {
    platform = 'zhipu'

    private _requester: ZhipuRequester

    private _models: Record<string, ModelInfo>

    constructor(
        ctx: Context,
        private _config: Config,
        clientConfig: ClientConfig
    ) {
        super(ctx, clientConfig)

        this._requester = new ZhipuRequester(clientConfig)
    }

    async init(): Promise<void> {
        await this.getModels()
    }

    async refreshModels(): Promise<ModelInfo[]> {
        const rawModels = [
            'ChatGLM-Pro',
            'ChatGLM-Std',
            'ChatGLM-Lite',
            'ChatGLM-Lite-32K'
        ]

        return rawModels.map((model) => {
            return {
                name: model,
                type: ModelType.llm,
                supportMode: ['all'],
                maxTokens: model.includes('32k') ? 32768 : 8192
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

        return models
    }

    protected _createModel(model: string): ChatLunaChatModel {
        const info = this._models[model]

        if (info == null) {
            throw new ChatLunaError(ChatLunaErrorCode.MODEL_NOT_FOUND)
        }

        return new ChatLunaChatModel({
            modelInfo: info,
            requester: this._requester,
            model: model.toLocaleLowerCase().replaceAll('-', '_'),
            modelMaxContextSize: info.maxTokens,
            maxTokens: this._config.maxTokens,
            frequencyPenalty: this._config.frequencyPenalty,
            presencePenalty: this._config.presencePenalty,
            timeout: this._config.timeout,
            temperature: this._config.temperature,
            maxRetries: this._config.maxRetries,
            llmType: 'zhipu'
        })
    }
}
