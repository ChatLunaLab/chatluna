import { Context } from 'koishi'
import { PlatformModelAndEmbeddingsClient } from 'koishi-plugin-chatluna/llm-core/platform/client'
import {
    ChatLunaBaseEmbeddings,
    ChatLunaChatModel,
    ChatLunaEmbeddings
} from 'koishi-plugin-chatluna/llm-core/platform/model'
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
import { QWenRequester } from './requester'
import { ChatLunaPlugin } from 'koishi-plugin-chatluna/services/chat'
import { supportImageInput } from '@chatluna/v1-shared-adapter'

export class QWenClient extends PlatformModelAndEmbeddingsClient {
    platform = 'qwen'

    private _requester: QWenRequester

    constructor(
        ctx: Context,
        private _config: Config,
        public plugin: ChatLunaPlugin
    ) {
        super(ctx, plugin.platformConfigPool)

        this._requester = new QWenRequester(
            ctx,
            plugin.platformConfigPool,
            _config,
            plugin
        )
    }

    async refreshModels(): Promise<ModelInfo[]> {
        // thinking -> ''
        // default -> thinking
        const rawModels: [string, number | undefined][] = [
            ['qwen-turbo', 100000],
            ['qwen-long', 1_000_000],
            ['qwen-plus', 131072],
            ['qwen-plus-character', 32768],
            ['qwen-max', 30720],
            ['qwen-max-latest', 131_072],
            ['qwen3-max', 262_144],
            ['qwen-plus-latest-non-thinking', 1_000_000],
            ['qwen-plus-latest-thinking', 1_000_000],
            ['qwen-turbo-latest-non-thinking', 1_000_000],
            ['qwen-turbo-latest-thinking', 1_000_000],
            ['qwen-flash', 1_000_000],
            ['qwen3-vl-plus-thinking', 262_144],
            ['qwen3-vl-plus-non-thinking', 262_144],
            ['qwen-vl-max', 131_072],
            ['qwen-vl-max-latest', 131_072],
            ['qwen-vl-plus', 131_072],
            ['qwen-vl-plus-latest', 131_072],
            ['qwen-vl-ocr', 34096],
            ['qwen-vl-ocr-latest', 34096],
            ['qwq-32b-preview', 30720],
            ['qvq-72b-preview', 30720],
            ['qwq-plus', 131072],
            ['qwq-plus-latest', 131072],
            ['qwen-omni-turbo', 32768],
            ['qwen-omni-turbo-latest', 32768],
            ['qwen-math-plus', 4000],
            ['qwen-math-turbo', 4000],
            ['qwen3-next-80b-a3b-default', 126_976],
            ['qwen3-next-80b-a3b-instruct', 126_024],
            ['qwen3-235b-a22b-default-2507', 131072],
            ['qwen3-235b-a22b-instruct-2507', 131072],
            ['qwen3-32b-thinking', 131072],
            ['qwen3-32b-non-thinking', 131072],
            ['qwen3-30b-a3b-thinking', 131072],
            ['qwen3-30b-a3b-non-thinking', 131072],
            ['qwen3-14b-thinking', 131072],
            ['qwen3-14b-non-thinking', 131072],
            ['qwen3-8b-thinking', 131072],
            ['qwen3-8b-non-thinking', 131072],
            ['qwen3-4b-thinking', 131072],
            ['qwen3-4b-non-thinking', 131072],
            ['qwen3-1.7b-thinking', 30720],
            ['qwen3-1.7b-non-thinking', 30720],
            ['qwen3-0.6b-thinking', 30720],
            ['qwen3-0.6b-non-thinking', 30720],
            ['qwen3-omni-flash-thinking', 65536],
            ['qwen3-omni-flash-non-thinking', 65536],
            ['qwen-omni-turbo', 32768],
            ['qwen-omni-latest', 32768],
            ['qwen3-vl-235b-a22b-default', 131072],
            ['qwen3-vl-235b-a22b-instruct', 131072],
            ['qwen2.5-vl-72b-instruct', 131072],
            ['qwen2.5-vl-32b-instruct', 129024],
            ['qwen2.5-vl-7b-instruct', 8192],
            ['qwen2.5-vl-3b-instruct', 8192],
            ['qwen-vl-v1', 8000],
            ['Moonshot-Kimi-K2-Instruct', 131072],
            ['deepseek-r1', 131072],
            ['deepseek-v3', 65536],
            ['text-embedding-v1', 2048],
            ['text-embedding-v2', 2048],
            ['text-embedding-v3', 8192]
        ] as [string, number][]

        const additionalModels = this._config.additionalModels.map(
            ({ model, modelType, contextSize, modelCapabilities }) =>
                ({
                    name: model,
                    type:
                        modelType === 'Embeddings 嵌入模型'
                            ? ModelType.embeddings
                            : ModelType.llm,
                    capabilities: modelCapabilities,
                    maxTokens: contextSize ?? 4096
                }) as ModelInfo
        )

        return rawModels
            .map(([model, token]) => {
                return {
                    name: model,
                    type: model.includes('embedding')
                        ? ModelType.embeddings
                        : ModelType.llm,
                    maxTokens: token,
                    capabilities: [
                        (model.includes('qwen-plus') ||
                            model.includes('qwen-max') ||
                            model.includes('qwen-turbo') ||
                            model.includes('qwen3') ||
                            model.includes('qwen2.5') ||
                            model.includes('omni') ||
                            model.includes('Kimi-K2') ||
                            model.includes('deepseek')) &&
                            ModelCapabilities.ToolCall,
                        supportImageInput(model) && ModelCapabilities.ImageInput
                    ].filter(Boolean)
                } as ModelInfo
            })
            .concat(additionalModels)
    }

    protected _createModel(
        model: string
    ): ChatLunaChatModel | ChatLunaBaseEmbeddings {
        const info = this._modelInfos[model]

        if (info == null) {
            throw new ChatLunaError(ChatLunaErrorCode.MODEL_NOT_FOUND)
        }

        if (info.type === ModelType.llm) {
            const modelMaxContextSize = info.maxTokens
            return new ChatLunaChatModel({
                modelInfo: info,
                requester: this._requester,
                model,
                modelMaxContextSize,
                maxTokenLimit: Math.floor(
                    (info.maxTokens || modelMaxContextSize || 128_000) *
                        this._config.maxContextRatio
                ),
                timeout: this._config.timeout,
                temperature: this._config.temperature,
                maxRetries: this._config.maxRetries,
                llmType: 'qwen',
                isThinkModel:
                    model.includes('reasoner') ||
                    model.includes('r1') ||
                    model.includes('thinking') ||
                    model.includes('qwq')
            })
        }

        return new ChatLunaEmbeddings({
            client: this._requester,
            model: info.name,
            batchSize: 5,
            maxRetries: this._config.maxRetries
        })
    }
}
