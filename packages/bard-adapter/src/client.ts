import {
    PlatformModelAndEmbeddingsClient,
    PlatformModelClient
} from '@dingyi222666/koishi-plugin-chathub/lib/llm-core/platform/client'
import { ClientConfig } from '@dingyi222666/koishi-plugin-chathub/lib/llm-core/platform/config'
import {
    ChatHubBaseEmbeddings,
    ChatHubChatModel,
    ChatHubEmbeddings
} from '@dingyi222666/koishi-plugin-chathub/lib/llm-core/platform/model'
import {
    ModelInfo,
    ModelType
} from '@dingyi222666/koishi-plugin-chathub/lib/llm-core/platform/types'
import { Context } from 'koishi'
import { Config } from '.'
import { ChatHubError, ChatHubErrorCode } from '@dingyi222666/koishi-plugin-chathub/lib/utils/error'
import { BardRequester } from './requester'
import {
    getModelContextSize,
    parseRawModelName
} from '@dingyi222666/koishi-plugin-chathub/lib/llm-core/utils/count_tokens'

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

        this._requester = new BardRequester(clientConfig)
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

    protected _createModel(model: string): ChatHubChatModel {
        return new ChatHubChatModel({
            requester: this._requester,
            model,
            modelMaxContextSize: 10000,
            timeout: this._config.timeout,
            maxRetries: this._config.maxRetries,
            llmType: 'bard'
        })
    }
}
