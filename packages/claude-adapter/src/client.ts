import { Context } from 'koishi'
import { ClaudeRequester } from './requester'
import { PlatformModelClient } from 'koishi-plugin-chatluna/src/llm-core/platform/client'
import { ClientConfig } from 'koishi-plugin-chatluna/src/llm-core/platform/config'
import { ChatLunaChatModel } from 'koishi-plugin-chatluna/src/llm-core/platform/model'
import {
    ModelInfo,
    ModelType
} from 'koishi-plugin-chatluna/src/llm-core/platform/types'
import { Config } from '.'

export class ClaudeClient extends PlatformModelClient {
    platform = 'claude'

    private _models: ModelInfo[]

    constructor(
        ctx: Context,
        private _config: Config,
        private _clientConfig: ClientConfig
    ) {
        super(ctx, _clientConfig)
    }

    async init(): Promise<void> {
        if (this._models) {
            return
        }

        const requester = new ClaudeRequester(
            this.ctx,
            this._config,
            this._clientConfig
        )

        await requester.init()

        this._models = await this.getModels()
    }

    async getModels(): Promise<ModelInfo[]> {
        if (this._models) {
            return this._models
        }

        return await this.refreshModels()
    }

    async refreshModels(): Promise<ModelInfo[]> {
        return [
            'claude-3-opus-20240229',
            'claude-3-sonnet-20240229',
            'claude-2.1',
            'claude-2.0',
            'claude-instant-1.2'
        ].map((model) => {
            return {
                name: model,
                maxTokens:
                    model.includes('2.0') || model.includes('1.2')
                        ? 1000000
                        : 2000000,
                type: ModelType.llm
            }
        })
    }

    protected _createModel(model: string): ChatLunaChatModel {
        const info = this._models.find((m) => m.name === model)
        return new ChatLunaChatModel({
            requester: new ClaudeRequester(
                this.ctx,
                this._config,
                this._clientConfig
            ),
            modelInfo: this._models[0],
            model,
            modelMaxContextSize: info.maxTokens ?? 100000,
            timeout: this._config.timeout,
            maxRetries: this._config.maxRetries,
            llmType: model
        })
    }
}
