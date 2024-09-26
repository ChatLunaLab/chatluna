import { PlatformModelAndEmbeddingsClient } from 'koishi-plugin-chatluna/llm-core/platform/client'
import { ClientConfig } from 'koishi-plugin-chatluna/llm-core/platform/config'
import {
    ChatHubBaseEmbeddings,
    ChatLunaChatModel,
    ChatLunaEmbeddings
} from 'koishi-plugin-chatluna/llm-core/platform/model'
import {
    ModelInfo,
    ModelType
} from 'koishi-plugin-chatluna/llm-core/platform/types'
import { Context } from 'koishi'
import { Config } from '.'
import {
    ChatLunaError,
    ChatLunaErrorCode
} from 'koishi-plugin-chatluna/utils/error'
import { WenxinRequester } from './requester'
import { ChatLunaPlugin } from 'koishi-plugin-chatluna/services/chat'

export class WenxinClient extends PlatformModelAndEmbeddingsClient<ClientConfig> {
    platform = 'wenxin'

    private _requester: WenxinRequester

    private _models: Record<string, ModelInfo>

    constructor(
        ctx: Context,
        private _config: Config,
        clientConfig: ClientConfig,
        plugin: ChatLunaPlugin<ClientConfig, Config>
    ) {
        super(ctx, clientConfig)

        this._requester = new WenxinRequester(clientConfig, _config, plugin)
    }

    async init(): Promise<void> {
        await this.getModels()
    }

    /*     // eslint-disable-next-line @typescript-eslint/naming-convention
    'ERNIE-4.0': (accessToken: string) => {
        return `https://aip.baidubce.com/rpc/2.0/ai_custom/v1/wenxinworkshop/chat/completions_pro?access_token=${accessToken}`
    },
    // https://aip.baidubce.com/rpc/2.0/ai_custom/v1/wenxinworkshop/chat/ernie-4.0-turbo-8k
    'ERNIE-4.0-turbo': (accessToken: string) => {
        return `https://aip.baidubce.com/rpc/2.0/ai_custom/v1/wenxinworkshop/chat/ernie-4.0-turbo-8k?access_token=${accessToken}`
    },

    // https://aip.baidubce.com/rpc/2.0/ai_custom/v1/wenxinworkshop/chat/completions
    'ERNIE-3.5': (accessToken: string) => {
        return `https://aip.baidubce.com/rpc/2.0/ai_custom/v1/wenxinworkshop/chat/completions?access_token=${accessToken}`
    },

    // https://aip.baidubce.com/rpc/2.0/ai_custom/v1/wenxinworkshop/chat/ernie-3.5-128k
    'ERNIE-3.5-128k': (accessToken: string) => {
        return `https://aip.baidubce.com/rpc/2.0/ai_custom/v1/wenxinworkshop/chat/ernie-3.5-128k?access_token=${accessToken}`
    },

    // https://aip.baidubce.com/rpc/2.0/ai_custom/v1/wenxinworkshop/chat/ernie-speed-pro-128k
    'ERNIE-speed-pro': (accessToken: string) => {
        return `https://aip.baidubce.com/rpc/2.0/ai_custom/v1/wenxinworkshop/chat/ernie-speed-pro-128k?access_token=${accessToken}`
    },
    // https://aip.baidubce.com/rpc/2.0/ai_custom/v1/wenxinworkshop/chat/ernie_speed
    'ERNIE-speed': (accessToken: string) => {
        return `https://aip.baidubce.com/rpc/2.0/ai_custom/v1/wenxinworkshop/chat/ernie_speed?access_token=${accessToken}`
    },
    // https://aip.baidubce.com/rpc/2.0/ai_custom/v1/wenxinworkshop/chat/ernie-speed-128k
    'ERNIE-speed-128k': (accessToken: string) => {
        return `https://aip.baidubce.com/rpc/2.0/ai_custom/v1/wenxinworkshop/chat/ernie-speed-128k?access_token=${accessToken}`
    },
    // https://aip.baidubce.com/rpc/2.0/ai_custom/v1/wenxinworkshop/chat/ernie-lite-8k
    'ERNIE-lite': (accessToken: string) => {
        return `https://aip.baidubce.com/rpc/2.0/ai_custom/v1/wenxinworkshop/chat/ernie-lite-8k?access_token=${accessToken}`
    },
    // https://aip.baidubce.com/rpc/2.0/ai_custom/v1/wenxinworkshop/chat/ernie-lite-pro-128k
    'ERNIE-lite-pro': (accessToken: string) => {
        return `https://aip.baidubce.com/rpc/2.0/ai_custom/v1/wenxinworkshop/chat/ernie-lite-pro-128k?access_token=${accessToken}`
    },
    // https://aip.baidubce.com/rpc/2.0/ai_custom/v1/wenxinworkshop/chat/ernie-tiny-8k
    'ERNIE-tiny': (accessToken: string) => {
        return `https://aip.baidubce.com/rpc/2.0/ai_custom/v1/wenxinworkshop/chat/ernie-tiny-8k?access_token=${accessToken}`
    },
    // https://aip.baidubce.com/rpc/2.0/ai_custom/v1/wenxinworkshop/chat/ernie-novel-8k
    'ERNIE-novel': (accessToken: string) => {
        return `https://aip.baidubce.com/rpc/2.0/ai_custom/v1/wenxinworkshop/chat/ernie-novel-8k?access_token=${accessToken}`
    },
    // https://aip.baidubce.com/rpc/2.0/ai_custom/v1/wenxinworkshop/chat/ernie-char-8k
    'ERNIE-char': (accessToken: string) => {
        return `https://aip.baidubce.com/rpc/2.0/ai_custom/v1/wenxinworkshop/chat/ernie-char-8k?access_token=${accessToken}`
    } */

    async refreshModels(): Promise<ModelInfo[]> {
        const rawModels = [
            ['ERNIE-4.0', 8000],
            ['ERNIE-4.0-turbo', 8000],
            ['ERNIE-3.5', 4096],
            ['ERNIE-3.5-128k', 128000],
            ['ERNIE-speed-pro', 128000],
            ['ERNIE-speed', 4096],
            ['ERNIE-speed-128k', 128000],
            ['ERNIE-lite', 8000],
            ['ERNIE-lite-pro', 128000],
            ['ERNIE-tiny', 8000],
            ['ERNIE-novel', 8000],
            ['ERNIE-character', 8000]
        ] as [string, number][]

        return rawModels
            .map(([model, maxTokens]) => {
                return {
                    name: model,
                    type: ModelType.llm,
                    functionCall: model.includes('ERNIE-3.5'),
                    supportMode: ['all'],
                    maxTokens
                }
            })
            .concat([
                {
                    name: 'text-embedding',
                    type: ModelType.embeddings,
                    functionCall: false,
                    supportMode: ['all'],
                    maxTokens: 4000
                } satisfies ModelInfo
            ])
    }

    async getModels(): Promise<ModelInfo[]> {
        if (this._models) {
            return Object.values(this._models)
        }

        const models = await this.refreshModels()

        this._models = {}

        for (const model of models) {
            this._models[model.name] = model
        }

        return models
    }

    protected _createModel(
        model: string
    ): ChatLunaChatModel | ChatHubBaseEmbeddings {
        const info = this._models[model]

        if (info == null) {
            throw new ChatLunaError(ChatLunaErrorCode.MODEL_NOT_FOUND)
        }

        if (info.type === ModelType.llm) {
            return new ChatLunaChatModel({
                modelInfo: info,
                requester: this._requester,
                model,
                modelMaxContextSize: info.maxTokens,
                maxTokenLimit: this._config.maxTokens,
                frequencyPenalty: this._config.frequencyPenalty,
                presencePenalty: this._config.presencePenalty,
                timeout: this._config.timeout,
                temperature: this._config.temperature,
                maxRetries: this._config.maxRetries,
                llmType: 'wenxin'
            })
        }

        return new ChatLunaEmbeddings({
            client: this._requester,
            maxRetries: this._config.maxRetries
        })
    }
}
