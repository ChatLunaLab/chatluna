import { PlatformModelAndEmbeddingsClient, PlatformModelClient } from '@dingyi222666/koishi-plugin-chathub/lib/llm-core/platform/client'
import { ClientConfig } from '@dingyi222666/koishi-plugin-chathub/lib/llm-core/platform/config'
import { ChatHubBaseEmbeddings, ChatHubChatModel, ChatHubEmbeddings } from '@dingyi222666/koishi-plugin-chathub/lib/llm-core/platform/model'
import { ModelInfo, ModelType } from '@dingyi222666/koishi-plugin-chathub/lib/llm-core/platform/types'
import { Context } from 'koishi'
import { Config } from '.'
import { ChatHubError, ChatHubErrorCode } from '@dingyi222666/koishi-plugin-chathub/lib/utils/error'
import { LMSYSRequester } from './requester'
import { getModelContextSize, parseRawModelName } from '@dingyi222666/koishi-plugin-chathub/lib/llm-core/utils/count_tokens'
import { LmsysClientConfig } from './types'

export class LMSYSClient extends PlatformModelClient<LmsysClientConfig> {
    platform = 'lmsys'

    private _requester: LMSYSRequester

    private _models: ModelInfo[]

    private _rawModels = {
        vicuna: 'vicuna-33b',
        codellama: 'codellama-34b-instruct',
        chatglm: 'chatglm2-6b',
        llama2: 'llama-2-70b-chat',
        wizardlm: 'wizardlm-13b',
        mpt: 'mpt-30b-chat'
    }

    constructor(
        ctx: Context,
        private _config: Config,
        clientConfig: LmsysClientConfig
    ) {
        super(ctx, clientConfig)

        this._requester = new LMSYSRequester(clientConfig)
    }

    async init(): Promise<void> {
        if (this._models) {
            return
        }
        await this._requester.init()

        const models = await this.getModels()

        this._models = models
    }

    async getModels(): Promise<ModelInfo[]> {
        if (this._models) {
            return this._models
        }

        return Object.keys(this._rawModels).map((model) => {
            return {
                name: model,
                type: ModelType.llm,
                supportChatMode: (mode: string) => {
                    return mode === 'chat'
                }
            }
        })
    }

    protected _createModel(model: string): ChatHubChatModel {
        const currentModelName = this._rawModels[model]

        if (currentModelName == null) {
            throw new ChatHubError(ChatHubErrorCode.MODEL_NOT_FOUND)
        }

        return new ChatHubChatModel({
            requester: this._requester,
            model: currentModelName,
            modelMaxContextSize: 4096,
            timeout: this._config.timeout,
            maxRetries: this._config.maxRetries,
            llmType: 'lmsys'
        })
    }
}
