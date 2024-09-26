import { Context } from 'koishi'
import { PlatformModelClient } from 'koishi-plugin-chatluna/llm-core/platform/client'
import { ChatLunaChatModel } from 'koishi-plugin-chatluna/llm-core/platform/model'
import {
    ModelInfo,
    ModelType
} from 'koishi-plugin-chatluna/llm-core/platform/types'
import {
    ChatLunaError,
    ChatLunaErrorCode
} from 'koishi-plugin-chatluna/utils/error'
import { Config } from '.'
import { SparkRequester } from './requester'
import { SparkClientConfig } from './types'
import { ChatLunaPlugin } from 'koishi-plugin-chatluna/services/chat'

export class SparkClient extends PlatformModelClient<SparkClientConfig> {
    platform = 'spark'

    private _requester: SparkRequester

    private _models: Record<string, SparkModelInfo>

    constructor(
        ctx: Context,
        private _config: Config,
        clientConfig: SparkClientConfig,
        plugin: ChatLunaPlugin
    ) {
        super(ctx, clientConfig)

        this._requester = new SparkRequester(ctx, clientConfig, _config, plugin)
    }

    async init(): Promise<void> {
        await this.getModels()
    }

    async refreshModels(): Promise<ModelInfo[]> {
        const rawModels = [
            ['spark-lite', 8192],
            ['spark-pro', 8192],
            ['spark-pro-128k', 128000],
            ['spark-max', 8192],
            ['spark-max-32k', 32768],
            ['spark-4.0-ultra', 8192]
        ] as [string, number][]
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

        for (const [model, maxTokens] of rawModels) {
            result.push({
                name: model,
                maxTokens,
                type: ModelType.llm,
                functionCall:
                    model.startsWith('spark-max') ||
                    model.startsWith('spark-4.0-ultra'),
                supportMode: ['all'],
                assistantId: undefined
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
            maxTokenLimit: this._config.maxTokens,
            timeout: this._config.timeout,
            temperature: this._config.temperature,
            maxRetries: this._config.maxRetries,
            llmType: 'spark',
            modelMaxContextSize: info.maxTokens
        })
    }
}

type SparkModelInfo = ModelInfo & { assistantId?: string }
