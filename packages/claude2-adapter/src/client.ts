import { Context } from 'koishi'
import { PlatformModelClient } from 'koishi-plugin-chatluna/llm-core/platform/client'
import { ChatLunaChatModel } from 'koishi-plugin-chatluna/llm-core/platform/model'
import {
    ModelInfo,
    ModelType
} from 'koishi-plugin-chatluna/llm-core/platform/types'
import { Config } from '.'
import { Claude2Requester } from './requester'
import { Claude2ClientConfig } from './types'

export class Claude2Client extends PlatformModelClient<Claude2ClientConfig> {
    platform = 'claude2'

    private _models: ModelInfo[]

    private _organizationId: string

    constructor(
        ctx: Context,
        private _config: Config,
        private _clientConfig: Claude2ClientConfig
    ) {
        super(ctx, _clientConfig)
    }

    async init(): Promise<void> {
        if (this._models) {
            return
        }

        const requester = new Claude2Requester(
            this.ctx,
            this._config,
            this._clientConfig
        )

        await requester.init()

        this._organizationId = requester.organizationId

        this._models = await this.getModels()
    }

    async getModels(): Promise<ModelInfo[]> {
        if (this._models) {
            return this._models
        }

        return await this.refreshModels()
    }

    async refreshModels(): Promise<ModelInfo[]> {
        return ['claude2'].map((model) => {
            return {
                name: model,
                type: ModelType.llm,
                chatMode: ['chat']
            }
        })
    }

    protected _createModel(model: string): ChatLunaChatModel {
        return new ChatLunaChatModel({
            requester: new Claude2Requester(
                this.ctx,
                this._config,
                this._clientConfig,
                this._organizationId
            ),
            modelInfo: this._models[0],
            model,
            modelMaxContextSize: 10000,
            timeout: this._config.timeout,
            maxRetries: this._config.maxRetries,
            llmType: 'claude2'
        })
    }
}
