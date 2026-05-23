import { Context } from 'koishi'
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
import { Config, logger } from '.'
import { DifyRequester } from './requester'
import { ChatLunaPlugin } from 'koishi-plugin-chatluna/services/chat'
import { PlatformModelClient } from 'koishi-plugin-chatluna/llm-core/platform/client'
import { DifyClientConfig } from './types'

import type { ModelUsageReporter } from 'koishi-plugin-chatluna/llm-core/platform/usage'

export class DifyClient extends PlatformModelClient<DifyClientConfig> {
    platform = 'dify'

    private _requester: DifyRequester

    constructor(
        ctx: Context,
        private _config: Config,
        public plugin: ChatLunaPlugin<DifyClientConfig>
    ) {
        super(ctx, plugin.platformConfigPool)

        this._requester = new DifyRequester(
            ctx,
            plugin.platformConfigPool,
            _config,
            plugin
        )
    }

    async init(): Promise<void> {
        await this.getModels()
    }

    async refreshModels(): Promise<ModelInfo[]> {
        return this._config.additionalModels.map(
            ({ apiKey, workflowName, workflowType }) => {
                return {
                    name: workflowName,
                    type: ModelType.llm,

                    maxTokens: 100000000000,
                    capabilities: [ModelCapabilities.ImageInput]
                }
            }
        )
    }

    protected _createModel(
        model: string,
        report: ModelUsageReporter
    ): ChatLunaChatModel {
        const info = this._modelInfos[model]

        if (info == null) {
            logger.warn(
                `Model ${model} not found`,
                JSON.stringify(this._modelInfos)
            )
            throw new ChatLunaError(ChatLunaErrorCode.MODEL_NOT_FOUND)
        }

        if (info.type === ModelType.llm) {
            return new ChatLunaChatModel({
                usageReporter: report,
                modelInfo: info,
                requester: this._requester,
                model,
                modelMaxContextSize: info.maxTokens,
                maxTokenLimit: Math.floor(
                    info.maxTokens * this._config.maxContextRatio
                ),
                timeout: this._config.timeout,
                temperature: this._config.temperature,
                maxRetries: this._config.maxRetries,
                llmType: 'dify'
            })
        }

        throw new ChatLunaError(
            ChatLunaErrorCode.MODEL_INIT_ERROR,
            new Error(
                `Model ${model} is not a chat model (type: ${ModelType[info.type]})`
            )
        )
    }
}
