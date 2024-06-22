import { PlatformModelClient } from 'koishi-plugin-chatluna/llm-core/platform/client'
import { ClientConfig } from 'koishi-plugin-chatluna/llm-core/platform/config'
import { ChatLunaChatModel } from 'koishi-plugin-chatluna/llm-core/platform/model'
import {
    ModelInfo,
    ModelType
} from 'koishi-plugin-chatluna/llm-core/platform/types'
import { Context } from 'koishi'
import { Config } from '.'
import { BardRequester } from './requester'

export class BardClient extends PlatformModelClient {
    platform = 'bard'

    private _requester: BardRequester

    private _models: ModelInfo[]

    constructor(
        ctx: Context,
        private _config: Config,
        clientConfig: ClientConfig
    ) {
        super(ctx, clientConfig)

        this._requester = new BardRequester(ctx, clientConfig)
    }

    async init(): Promise<void> {
        if (this._models) {
            return
        }
        await this._requester.init()

        await this.getModels()
    }

    async getModels(): Promise<ModelInfo[]> {
        if (this._models) {
            return this._models
        }

        const models = await this.refreshModels()

        this._models = models

        return models
    }

    async refreshModels(): Promise<ModelInfo[]> {
        return ['bard'].map((model) => {
            return {
                name: model,
                type: ModelType.llm,
                supportChatMode: (mode: string) => {
                    return mode === 'chat'
                }
            }
        })
    }

    protected _createModel(model: string): ChatLunaChatModel {
        return new ChatLunaChatModel({
            modelInfo: this._models[0],
            requester: this._requester,
            model,
            modelMaxContextSize: 5000,
            timeout: this._config.timeout,
            maxRetries: this._config.maxRetries,
            llmType: 'bard'
        })
    }
}
