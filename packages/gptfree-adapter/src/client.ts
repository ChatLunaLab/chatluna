import { PlatformModelClient } from 'koishi-plugin-chatluna/llm-core/platform/client'
import { ClientConfig } from 'koishi-plugin-chatluna/llm-core/platform/config'
import { ChatLunaChatModel } from 'koishi-plugin-chatluna/llm-core/platform/model'
import {
    ModelInfo,
    ModelType
} from 'koishi-plugin-chatluna/llm-core/platform/types'
import { Context } from 'koishi'
import { Config } from '.'
import {
    ChatLunaError,
    ChatLunaErrorCode
} from 'koishi-plugin-chatluna/utils/error'
import { GPTFreeRequester } from './requester'
import {
    getModelContextSize,
    parseRawModelName
} from 'koishi-plugin-chatluna/llm-core/utils/count_tokens'
import { ChatLunaPlugin } from 'koishi-plugin-chatluna/services/chat'

export class GPTFreeClient extends PlatformModelClient<ClientConfig> {
    platform = 'gptfree'

    private _requester: GPTFreeRequester

    private _models: Record<string, ModelInfo>

    constructor(
        ctx: Context,
        private _config: Config,
        clientConfig: ClientConfig,
        plugin: ChatLunaPlugin
    ) {
        super(ctx, clientConfig)

        this._requester = new GPTFreeRequester(ctx, clientConfig, plugin)
    }

    async init(): Promise<void> {
        await this.getModels()
    }

    async refreshModels(): Promise<ModelInfo[]> {
        try {
            const rawModels = await this._requester.getModels()

            return rawModels.map((model) => {
                return {
                    name: model,
                    type: ModelType.llm,
                    supportMode: ['chat']
                }
            })
        } catch (e) {
            throw new ChatLunaError(ChatLunaErrorCode.MODEL_INIT_ERROR, e)
        }
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

    protected _createModel(model: string): ChatLunaChatModel {
        const info = this._models[model]

        if (info == null) {
            throw new ChatLunaError(ChatLunaErrorCode.MODEL_NOT_FOUND)
        }

        const [, modelName] = parseRawModelName(model)

        return new ChatLunaChatModel({
            modelInfo: info,
            requester: this._requester,
            model,
            modelMaxContextSize: getModelContextSize(modelName),
            timeout: this._config.timeout,
            maxRetries: this._config.maxRetries,
            llmType: 'gptfree'
        })
    }
}
