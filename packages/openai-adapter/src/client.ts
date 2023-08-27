import { PlatformModelAndEmbeddingsClient } from '@dingyi222666/koishi-plugin-chathub/lib/llm-core/platform/client';
import { ClientConfig } from '@dingyi222666/koishi-plugin-chathub/lib/llm-core/platform/config';
import { ChatHubChatModel, ChatHubBaseEmbeddings } from '@dingyi222666/koishi-plugin-chathub/lib/llm-core/platform/model';
import { ModelInfo, ModelType } from '@dingyi222666/koishi-plugin-chathub/lib/llm-core/platform/types';
import { Context } from 'koishi';
import { Config } from '.';
import { OpenAIRequester } from './requester';

export class OpenAIClient extends PlatformModelAndEmbeddingsClient<ClientConfig> {
    platform = "openai"

    private _requester: OpenAIRequester

    private _models: ModelInfo[]


    constructor(ctx: Context, private _config: Config, clientConfig: ClientConfig) {
        super(ctx, clientConfig);

        this._requester = new OpenAIRequester(clientConfig)
    }

    async init(): Promise<void> {
        this._models = await this.getModels()
    }


    async getModels(): Promise<ModelInfo[]> {
        if (this._models) {
            return this._models
        }

        const rawModels = await this._requester.getModels()


        return rawModels.filter((model) => model.includes("gpt") || model.includes("text-embedding")).map((model) => {
            return {
                name: model,
                type: model.includes("gpt") ? ModelType.llm : ModelType.embeddings
            }
        })
    }


    protected _createModel(model: string): ChatHubChatModel | ChatHubBaseEmbeddings {
        throw new Error('Method not implemented.');
    }

}