import { PlatformModelAndEmbeddingsClient, PlatformModelClient } from '@dingyi222666/koishi-plugin-chathub/lib/llm-core/platform/client';
import { ClientConfig } from '@dingyi222666/koishi-plugin-chathub/lib/llm-core/platform/config';
import { ChatHubChatModel, ChatHubBaseEmbeddings, ChatHubEmbeddings } from '@dingyi222666/koishi-plugin-chathub/lib/llm-core/platform/model';
import { ModelInfo, ModelType } from '@dingyi222666/koishi-plugin-chathub/lib/llm-core/platform/types';
import { Context } from 'koishi';
import { Config } from '.';
import { ChatHubError, ChatHubErrorCode } from "@dingyi222666/koishi-plugin-chathub/lib/utils/error"
import { Claude2Requester } from './requester';
import { getModelContextSize, parseRawModelName } from '@dingyi222666/koishi-plugin-chathub/lib/llm-core/utils/count_tokens';
import { Claude2ClientConfig } from './types';


export class Claude2Client extends PlatformModelClient<Claude2ClientConfig> {
    platform = "claude2"

    private _models: ModelInfo[]

    private _organizationId: string

    constructor(ctx: Context, private _config: Config, private _clientConfig: Claude2ClientConfig) {
        super(ctx, _clientConfig);
    }

    async init(): Promise<void> {
        if (this._models) {
            return
        }

        const requester = new Claude2Requester(this.ctx,this._clientConfig)

        await requester.init()

        this._organizationId = requester.organizationId

        const models = await this.getModels()

        this._models = models
    }


    async getModels(): Promise<ModelInfo[]> {
        if (this._models) {
            return this._models
        }

        return ['claude2'].map((model) => {
            return {
                name: model,
                type: ModelType.llm,
                supportChatMode: (mode: string) => {
                    return mode === "chat"
                }
            }
        })
    }


    protected _createModel(model: string): ChatHubChatModel {
        return new ChatHubChatModel({
            requester: new Claude2Requester(this.ctx,this._clientConfig, this._organizationId),
            model: model,
            modelMaxContextSize: 10000,
            timeout: this._config.timeout,
            maxRetries: this._config.maxRetries,
            llmType: "claude2"
        })

    }
}