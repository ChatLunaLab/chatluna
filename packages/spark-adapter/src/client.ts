import { Context } from 'koishi'
import { PlatformModelClient } from 'koishi-plugin-chatluna/lib/llm-core/platform/client'
import { ChatLunaChatModel } from 'koishi-plugin-chatluna/lib/llm-core/platform/model'
import {
    ModelInfo,
    ModelType
} from 'koishi-plugin-chatluna/lib/llm-core/platform/types'
import {
    ChatLunaError,
    ChatLunaErrorCode
} from 'koishi-plugin-chatluna/lib/utils/error'
import { Config } from '.'
import { SparkRequester } from './requester'
import { SparkClientConfig } from './types'

export class SparkClient extends PlatformModelClient<SparkClientConfig> {
    platform = 'spark'

    private _requester: SparkRequester

    private _models: Record<string, SparkModelInfo>

    constructor(
        ctx: Context,
        private _config: Config,
        clientConfig: SparkClientConfig
    ) {
        super(ctx, clientConfig)

        this._requester = new SparkRequester(ctx, clientConfig, _config)
    }

    async init(): Promise<void> {
        await this.getModels()
    }

    async refreshModels(): Promise<ModelInfo[]> {
        const rawModels = ['v1.5', 'v2', 'v3', 'v3.5']
        const result: SparkModelInfo[] = []

        if (this._config.assistants.length > 0) {
            for (const [name, url] of this._config.assistants) {
                result.push({
                    name,
                    maxTokens: 8192,
                    type: ModelType.llm,
                    functionCall: false,
                    supportMode: ['all'],
                    // ws(s)://spark-openapi.cn-huabei-1.xf-yun.com/v1/assistants/c81x3sabmvhi_v1
                    assistantId: url.match(/v1\/assistants\/(.*)/)?.[1] ?? url
                })
            }
        }

        for (const model of rawModels) {
            result.push({
                name: model,
                maxTokens: model === 'v1.5' ? 4096 : 8192,
                type: ModelType.llm,
                functionCall: model.startsWith('v3'),
                supportMode: ['all']
            })
        }

        return result
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
    }

    protected _createModel(model: string): ChatLunaChatModel {
        const info = this._models[model]

        if (info == null) {
            throw new ChatLunaError(ChatLunaErrorCode.MODEL_NOT_FOUND)
        }

        return new ChatLunaChatModel({
            modelInfo: info,
            requester: this._requester,
            model: info.assistantId ? `assistant:${info.assistantId}` : model,
            maxTokens: this._config.maxTokens,
            timeout: this._config.timeout,
            temperature: this._config.temperature,
            maxRetries: this._config.maxRetries,
            llmType: 'spark',
            modelMaxContextSize: info.maxTokens
        })
    }
}

type SparkModelInfo = ModelInfo & { assistantId?: string }
