import { PlatformModelAndEmbeddingsClient, PlatformModelClient } from '@dingyi222666/koishi-plugin-chathub/lib/llm-core/platform/client';
import { ClientConfig } from '@dingyi222666/koishi-plugin-chathub/lib/llm-core/platform/config';
import { ChatHubChatModel, ChatHubBaseEmbeddings, ChatHubEmbeddings } from '@dingyi222666/koishi-plugin-chathub/lib/llm-core/platform/model';
import { ModelInfo, ModelType } from '@dingyi222666/koishi-plugin-chathub/lib/llm-core/platform/types';
import { Context } from 'koishi';
import { Config } from '.';
import { ChatHubError, ChatHubErrorCode } from "@dingyi222666/koishi-plugin-chathub/lib/utils/error"
import { LMSYSRequester } from './requester';
import { getModelContextSize, parseRawModelName } from '@dingyi222666/koishi-plugin-chathub/lib/llm-core/utils/count_tokens';

export class LMSYSClient extends PlatformModelClient<ClientConfig> {
    platform = "lmsys"

    private _requester: LMSYSRequester

    private _models: ModelInfo[]

    private _rawModels = {
        'vicuna': 'vicuna-33b', 'alpaca': 'alpaca-13b', 'chatglm': 'chatglm-6b', 'llama2': 'llama-2-13b-chat', 'oasst': 'oasst-pythia-12b', 'rwkv': 'RWKV-4-Raven-14B', 'wizardlm': "wizardlm-13b", "guanaco": "guanaco-33b", "mpt": "mpt-30b-chat", "fastchat": "fastchat-t5-3b",
    }

    constructor(ctx: Context, private _config: Config, clientConfig: ClientConfig) {
        super(ctx, clientConfig);

        this._requester = new LMSYSRequester(clientConfig)
    }

    async init(): Promise<void> {
        const models = await this.getModels()

        this._models = models
    }


    async getModels(): Promise<ModelInfo[]> {
        if (this._models) {
            return this._models
        }

        this._models = Object.keys(this._rawModels).map((model) => {
            return {
                name: model,
                type: ModelType.llm,
                supportChatMode: (mode: string) => {
                    return true
                }
            }
        })
    }


    protected _createModel(model: string): ChatHubChatModel {
        const currentModelName = this._rawModels[model]

        if (currentModelName == null) {
            throw new ChatHubError(ChatHubErrorCode.MODEL_NOT_FOUND)
        }

        const [_, modelName] = parseRawModelName(model)

        return new ChatHubChatModel({
            requester: this._requester,
            model: currentModelName,
            modelMaxContextSize: 4096,
            timeout: this._config.timeout,
            maxRetries: this._config.maxRetries,
            llmType: "gptfree"
        })

    }
}