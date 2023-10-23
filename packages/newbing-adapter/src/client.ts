import { PlatformModelClient } from '@dingyi222666/koishi-plugin-chathub/lib/llm-core/platform/client'
import { ChatHubChatModel } from '@dingyi222666/koishi-plugin-chathub/lib/llm-core/platform/model'
import {
    ModelInfo,
    ModelType
} from '@dingyi222666/koishi-plugin-chathub/lib/llm-core/platform/types'
import { Context } from 'koishi'
import { Config } from '.'
import { BingRequester } from './requester'
import { BingClientConfig, BingConversationStyle } from './types'

export class BingClient extends PlatformModelClient<BingClientConfig> {
    platform = 'bing'

    private _models: ModelInfo[]

    constructor(
        ctx: Context,
        private _config: Config,
        private _clientConfig: BingClientConfig
    ) {
        super(ctx, _clientConfig)
    }

    async init(): Promise<void> {
        if (this._models) {
            return
        }

        const models = await this.getModels()

        this._models = models
    }

    async getModels(): Promise<ModelInfo[]> {
        if (this._models) {
            return this._models
        }

        return Object.values(BingConversationStyle).map((model) => {
            return {
                name: model.toLocaleLowerCase(),
                type: ModelType.llm,
                supportChatMode: (mode: string) => {
                    return mode === 'chat'
                }
            }
        })
    }

    protected _createModel(model: string): ChatHubChatModel {
        return new ChatHubChatModel({
            requester: new BingRequester(
                this.ctx,
                this._config,
                this._clientConfig,
                (model.charAt(0).toUpperCase() +
                    model.slice(1)) as BingConversationStyle
            ),
            model,
            modelMaxContextSize: 10000,
            timeout: this._config.timeout,
            maxRetries: this._config.maxRetries,
            llmType: 'bing'
        })
    }
}
