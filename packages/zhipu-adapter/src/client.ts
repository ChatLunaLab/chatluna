import { PlatformModelClient } from '@dingyi222666/koishi-plugin-chathub/lib/llm-core/platform/client'
import { ClientConfig } from '@dingyi222666/koishi-plugin-chathub/lib/llm-core/platform/config'
import { ChatHubChatModel } from '@dingyi222666/koishi-plugin-chathub/lib/llm-core/platform/model'
import {
    ModelInfo,
    ModelType
} from '@dingyi222666/koishi-plugin-chathub/lib/llm-core/platform/types'
import { Context } from 'koishi'
import { Config } from '.'
import { ChatHubError, ChatHubErrorCode } from '@dingyi222666/koishi-plugin-chathub/lib/utils/error'
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

        const rawModels = ['ChatGLM-Pro', 'ChatGLM-Std', 'ChatGLM-Lite', 'ChatGLM-Lite-32K']

        return rawModels.map((model) => {
            return {
                name: model,
                type: ModelType.llm,
                supportChatMode: (_) => true
            }
        })
    }

    protected _createModel(model: string): ChatHubChatModel {
        const info = this._models[model]

        if (info == null) {
            throw new ChatHubError(ChatHubErrorCode.MODEL_NOT_FOUND)
        }

        return new ChatHubChatModel({
            requester: this._requester,
            model: model.toLocaleLowerCase(),
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
