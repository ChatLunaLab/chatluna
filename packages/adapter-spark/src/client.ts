import { Context } from 'koishi'
import { PlatformModelClient } from 'koishi-plugin-chatluna/llm-core/platform/client'
import { ChatLunaChatModel } from 'koishi-plugin-chatluna/llm-core/platform/model'
import {
    ModelCapabilities,
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

    constructor(
        ctx: Context,
        private _config: Config,
        public plugin: ChatLunaPlugin<SparkClientConfig>
    ) {
        super(ctx, plugin.platformConfigPool)

        this._requester = new SparkRequester(
            ctx,
            plugin.platformConfigPool,
            _config,
            plugin
        )
    }

    async refreshModels(): Promise<ModelInfo[]> {
        const rawModels = [
            ['spark-lite', 8192],
            ['spark-pro', 8192],
            ['spark-pro-128k', 128000],
            ['spark-max', 8192],
            ['spark-max-32k', 32768],
            ['spark-4.0-ultra', 128000],
            ['spark-x1', 128000]
        ] as [string, number][]
        const result: SparkModelInfo[] = []

        for (const [model, maxTokens] of rawModels) {
            result.push({
                name: model,
                maxTokens,
                type: ModelType.llm,
                capabilities: [
                    (model.startsWith('spark-max') ||
                        model.startsWith('spark-4.0-ultra') ||
                        model === 'spark-x1') &&
                        ModelCapabilities.ToolCall
                ]
            })
        }

        return result
    }

    protected _createModel(model: string): ChatLunaChatModel {
        const info = this._modelInfos[model]

        if (info == null) {
            throw new ChatLunaError(ChatLunaErrorCode.MODEL_NOT_FOUND)
        }

        const modelMaxContextSize = info.maxTokens
        return new ChatLunaChatModel({
            modelInfo: info,
            requester: this._requester,
            model,
            maxTokenLimit: Math.floor(
                (info.maxTokens || modelMaxContextSize || 128_000) *
                    this._config.maxContextRatio
            ),
            timeout: this._config.timeout,
            temperature: this._config.temperature,
            maxRetries: this._config.maxRetries,
            llmType: 'spark',
            modelMaxContextSize
        })
    }
}

type SparkModelInfo = ModelInfo
