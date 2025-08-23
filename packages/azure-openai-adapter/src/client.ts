import { Context } from 'koishi'
import { PlatformModelAndEmbeddingsClient } from 'koishi-plugin-chatluna/llm-core/platform/client'
import {
    ChatLunaBaseEmbeddings,
    ChatLunaChatModel,
    ChatLunaEmbeddings
} from 'koishi-plugin-chatluna/llm-core/platform/model'
import {
    ModelInfo,
    ModelType
} from 'koishi-plugin-chatluna/llm-core/platform/types'
import {
    ChatLunaError,
    ChatLunaErrorCode
} from 'koishi-plugin-chatluna/utils/error'
import { Config, logger as pluginLogger } from '.'
import { OpenAIRequester } from './requester'
import { ChatLunaPlugin } from 'koishi-plugin-chatluna/services/chat'
import { AzureOpenAIClientConfig } from './types'

export class OpenAIClient extends PlatformModelAndEmbeddingsClient<AzureOpenAIClientConfig> {
    platform = 'azure'

    private _requester: OpenAIRequester

    get logger() {
        return pluginLogger
    }

    get config(): AzureOpenAIClientConfig {
        return this.configPool.getConfig(true).value
    }

    constructor(
        ctx: Context,
        private _config: Config,
        public plugin: ChatLunaPlugin
    ) {
        super(ctx, plugin.platformConfigPool)

        this._requester = new OpenAIRequester(
            this.config,
            plugin
        )
    }


    async refreshModels(): Promise<ModelInfo[]> {
        try {
            return this._config.supportModels.map(
                ({ model, modelType: llmType, contextSize: token }) => {
                    return {
                        name: model,
                        type:
                            llmType === 'Embeddings 嵌入模型'
                                ? ModelType.embeddings
                                : ModelType.llm,
                        functionCall: llmType === 'LLM 大语言模型（函数调用）',
                        maxTokens: token ?? 4096,
                        supportMode: ['all']
                    } as ModelInfo
                }
            )
        } catch (e) {
            throw new ChatLunaError(ChatLunaErrorCode.MODEL_INIT_ERROR, e)
        }
    }


    protected _createModel(
        model: string
    ): ChatLunaChatModel | ChatLunaBaseEmbeddings {
        const info = this._modelInfos[model]

        if (info == null) {
            throw new ChatLunaError(ChatLunaErrorCode.MODEL_NOT_FOUND)
        }

        if (info.type === ModelType.llm) {
            return new ChatLunaChatModel({
                modelInfo: info,
                requester: this._requester,
                model,
                maxTokenLimit: this._config.maxTokens,
                frequencyPenalty: this._config.frequencyPenalty,
                presencePenalty: this._config.presencePenalty,
                timeout: this._config.timeout,
                temperature: this._config.temperature,
                maxRetries: this._config.maxRetries,
                llmType: 'openai'
            })
        }

        return new ChatLunaEmbeddings({
            client: this._requester,
            model,
            maxRetries: this._config.maxRetries
        })
    }
}
