import { PlatformModelClient } from 'koishi-plugin-chatluna/lib/llm-core/platform/client'
import { ClientConfig } from 'koishi-plugin-chatluna/lib/llm-core/platform/config'
import { ChatHubChatModel } from 'koishi-plugin-chatluna/lib/llm-core/platform/model'
import {
    ModelInfo,
    ModelType
} from 'koishi-plugin-chatluna/lib/llm-core/platform/types'
import { Context } from 'koishi'
import { Config } from '.'
import {
    ChatHubError,
    ChatHubErrorCode
} from 'koishi-plugin-chatluna/lib/utils/error'
import { GPTFreeRequester } from './requester'
import {
    getModelContextSize,
    parseRawModelName
} from 'koishi-plugin-chatluna/lib/llm-core/utils/count_tokens'

export class GPTFreeClient extends PlatformModelClient<ClientConfig> {
    platform = 'gptfree'

    private _requester: GPTFreeRequester

    private _models: Record<string, ModelInfo>

    constructor(
        ctx: Context,
        private _config: Config,
        clientConfig: ClientConfig
    ) {
        super(ctx, clientConfig)

        this._requester = new GPTFreeRequester(ctx, clientConfig)
    }

    async init(): Promise<void> {
        const models = await this.getModels()

        this._models = {}

        for (const model of models) {
            this._models[model.name] = model
        }
    }

    async getModels(): Promise<ModelInfo[]> {
        if (this._models) {
            return Object.values(this._models)
        }

        try {
            const rawModels = await this._requester.getModels()

            return rawModels.map((model) => {
                return {
                    name: model,
                    type: ModelType.llm,
                    supportChatMode: (mode: string) => {
                        return mode === 'chat'
                    }
                }
            })
        } catch (e) {
            throw new ChatHubError(ChatHubErrorCode.MODEL_INIT_ERROR, e)
        }
    }

    protected _createModel(model: string): ChatHubChatModel {
        const info = this._models[model]

        if (info == null) {
            throw new ChatHubError(ChatHubErrorCode.MODEL_NOT_FOUND)
        }

        const [, modelName] = parseRawModelName(model)

        return new ChatHubChatModel({
            requester: this._requester,
            model,
            modelMaxContextSize: getModelContextSize(modelName),
            timeout: this._config.timeout,
            maxRetries: this._config.maxRetries,
            llmType: 'gptfree'
        })
    }
}
