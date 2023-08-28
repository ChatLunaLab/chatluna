import { PlatformModelAndEmbeddingsClient } from '@dingyi222666/koishi-plugin-chathub/lib/llm-core/platform/client';
import { ClientConfig } from '@dingyi222666/koishi-plugin-chathub/lib/llm-core/platform/config';
import { ChatHubChatModel, ChatHubBaseEmbeddings, ChatHubEmbeddings } from '@dingyi222666/koishi-plugin-chathub/lib/llm-core/platform/model';
import { ModelInfo, ModelType } from '@dingyi222666/koishi-plugin-chathub/lib/llm-core/platform/types';
import { Context } from 'koishi';
import { Config } from '.';
import { ChatHubError, ChatHubErrorCode } from "@dingyi222666/koishi-plugin-chathub/lib/utils/error"
import { OpenLLMRequester } from './requester';
import { get } from 'http';

export class OpenLLMClient extends PlatformModelAndEmbeddingsClient<ClientConfig> {
    platform = "chatglm"

    private _requester: OpenLLMRequester

    private _models: Record<string, ModelInfo>


    constructor(ctx: Context, private _config: Config, clientConfig: ClientConfig) {
        super(ctx, clientConfig);

        this._requester = new OpenLLMRequester(clientConfig)
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
                    supportChatMode: (_:string) => true
                }
            }).concat([
                {
                    name: this._config.embeddings,
                    type: ModelType.embeddings,
                    supportChatMode: (_:string) => true
                }
            ])
        } catch (e) {
            throw new ChatHubError(ChatHubErrorCode.MODEL_INIT_ERROR, e)
        }
    }


    protected _createModel(model: string): ChatHubChatModel | ChatHubBaseEmbeddings {
        const info = this._models[model]

        if (info == null) {
            throw new ChatHubError(ChatHubErrorCode.MODEL_NOT_FOUND)
        }

        if (info.type === ModelType.llm) {
            return new ChatHubChatModel({
                requester: this._requester,
                model: model,
                maxTokens: this._config.maxTokens,
                frequencyPenalty: this._config.frequencyPenalty,
                presencePenalty: this._config.presencePenalty,
                timeout: this._config.timeout,
                temperature: this._config.temperature,
                maxRetries: this._config.maxRetries,
                llmType: "chatglm",
                modelMaxContextSize: getModelContextSize(model)
            })
        }

        return new ChatHubEmbeddings({
            client: this._requester,
            maxRetries: this._config.maxRetries,
        })
    }

}

function getModelContextSize(model: string) {

    model = model.toLowerCase()

    if (model.includes("chatglm2")) {
        return 8192
    }

    if (model.includes("qwen")) {
        return 8192
    }

    return 4096
}