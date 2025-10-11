import { Context } from 'koishi'
import {
    ChatLunaError,
    ChatLunaErrorCode
} from 'koishi-plugin-chatluna/utils/error'
import { ChatLunaPlugin } from 'koishi-plugin-chatluna/services/chat'
import { Config } from '..'
import { ClientConfig } from 'koishi-plugin-chatluna/llm-core/platform/config'
import { PlatformEmbeddingsClient } from 'koishi-plugin-chatluna/llm-core/platform/client'
import { ChatLunaEmbeddings } from 'koishi-plugin-chatluna/llm-core/platform/model'
import {
    ModelCapabilities,
    ModelInfo,
    ModelType
} from 'koishi-plugin-chatluna/llm-core/platform/types'
import {
    EmbeddingsRequester,
    EmbeddingsRequestParams
} from 'koishi-plugin-chatluna/llm-core/platform/api'

export async function apply(
    ctx: Context,
    config: Config,
    plugin: ChatLunaPlugin<ClientConfig, Config>
) {
    if (!config.huggingface) {
        return
    }

    if ((config.huggingfaceModels?.length ?? 0) < 1) {
        throw new ChatLunaError(
            ChatLunaErrorCode.EMBEDDINGS_INIT_ERROR,
            new Error('No huggingface embedding models specified')
        )
    }

    plugin.registerClient(
        () => new HuggingfaceClient(ctx, config, plugin),
        'huggingface'
    )

    plugin.parseConfig((config) => {
        return config.huggingfaceApiKeys.map((apiKey) => {
            return {
                apiKey,
                platform: 'huggingface',
                maxRetries: config.maxRetries,
                concurrentMaxSize: config.chatConcurrentMaxSize,
                chatLimit: config.chatTimeLimit,
                timeout: config.timeout
            }
        })
    })
}

class HuggingfaceClient extends PlatformEmbeddingsClient {
    constructor(
        ctx: Context,
        private _config: Config,
        public plugin: ChatLunaPlugin
    ) {
        super(ctx, plugin.platformConfigPool)
    }

    platform = 'huggingface'

    async getModels(): Promise<ModelInfo[]> {
        return this.refreshModels()
    }

    async refreshModels(): Promise<ModelInfo[]> {
        return this._config.huggingfaceModels.map((model) => {
            return {
                name: model,
                type: ModelType.embeddings,
                maxTokens: 4096,
                capabilities: [] as ModelCapabilities[]
            }
        })
    }

    protected _createModel(model: string): ChatLunaEmbeddings {
        return new ChatLunaEmbeddings({
            maxConcurrency: 1,
            maxRetries: this._config.maxRetries,
            model,
            client: new HuggingfaceEmbeddingsRequester(
                this._config,
                this.plugin
            )
        })
    }
}

class HuggingfaceEmbeddingsRequester implements EmbeddingsRequester {
    private _inferenceClient: HfInference

    constructor(
        private _config: Config,
        private _plugin: ChatLunaPlugin
    ) {
        this._inferenceClient = new HfInference(_plugin, this._config)
    }

    async embeddings(
        params: EmbeddingsRequestParams
    ): Promise<number[] | number[][]> {
        const input =
            typeof params.input === 'string' ? [params.input] : params.input

        const result = await this._inferenceClient.featureExtraction({
            model: params.model,
            inputs: input
        })

        if (typeof params.input === 'string') {
            return result[0]
        } else {
            return result
        }
    }
}

class HfInference {
    constructor(
        private _plugin: ChatLunaPlugin,
        private _config: Config
    ) {}

    async featureExtraction(params: {
        model: string
        inputs: string[]
    }): Promise<number[][]> {
        const url =
            'https://api-inference.huggingface.co/models/' + params.model

        const headers = {
            Authorization: `Bearer ${this._config.huggingfaceApiKeys[0]}`
        }

        const response = await this._plugin.fetch(url, {
            method: 'POST',
            body: JSON.stringify(params.inputs),
            headers
        })

        if (!response.ok) {
            if (
                response.headers
                    .get('Content-Type')
                    ?.startsWith('application/json')
            ) {
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                const output: any = await response.json()
                if (output.error) {
                    throw new Error(output.error)
                }
            }
            throw new Error('An error occurred while fetching the blob')
        }

        return (await response.json()) as number[][]
    }
}
