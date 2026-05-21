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
import { Config, logger } from '.'
import { SparkRequester } from './requester'
import { SparkClientConfig } from './types'
import { ChatLunaPlugin } from 'koishi-plugin-chatluna/services/chat'
import { hasSparkModelPassword, sparkModelCatalog } from './utils'

import type { ModelUsageReporter } from 'koishi-plugin-chatluna/llm-core/platform/usage'

export class SparkClient extends PlatformModelClient<SparkClientConfig> {
    platform = 'spark'

    private _requester: SparkRequester

    constructor(
        ctx: Context,
        private _config: Config,
        public plugin: ChatLunaPlugin<SparkClientConfig, Config>
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
        const configs = this.configPool.getConfigs()
        const result: SparkModelInfo[] = []

        for (const definition of sparkModelCatalog) {
            const hasPassword = configs.some((config) => {
                return hasSparkModelPassword(
                    config.value.apiPasswords,
                    definition.name
                )
            })

            if (!hasPassword) {
                continue
            }

            result.push({
                name: definition.name,
                maxTokens: definition.maxTokens,
                type: ModelType.llm,
                capabilities: definition.capabilities
            })
        }

        return result
    }

    protected _createModel(
        model: string,
        report: ModelUsageReporter,
        source: string
    ): ChatLunaChatModel {
        const info = this._modelInfos[model]

        if (info == null) {
            logger.warn(
                `Model ${model} not found`,
                JSON.stringify(this._modelInfos)
            )
            throw new ChatLunaError(ChatLunaErrorCode.MODEL_NOT_FOUND)
        }

        const modelMaxContextSize = info.maxTokens
        return new ChatLunaChatModel({
            usageReporter: report,
            usageSource: source,
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
