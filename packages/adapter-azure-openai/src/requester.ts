import { ChatGenerationChunk } from '@langchain/core/outputs'
import {
    EmbeddingsRequester,
    EmbeddingsRequestParams,
    ModelRequester,
    ModelRequestParams
} from 'koishi-plugin-chatluna/llm-core/platform/api'
import { Config, logger } from '.'
import { ChatLunaPlugin } from 'koishi-plugin-chatluna/services/chat'
import {
    ClientConfig,
    ClientConfigPool
} from 'koishi-plugin-chatluna/llm-core/platform/config'
import { Context } from 'koishi'
import {
    completionStream,
    createEmbeddings,
    createRequestContext
} from '@chatluna/v1-shared-adapter'

export class OpenAIRequester
    extends ModelRequester
    implements EmbeddingsRequester
{
    constructor(
        ctx: Context,
        _configPool: ClientConfigPool<ClientConfig>,
        public _pluginConfig: Config,
        _plugin: ChatLunaPlugin
    ) {
        super(ctx, _configPool, _pluginConfig, _plugin)
    }

    async *completionStreamInternal(
        params: ModelRequestParams
    ): AsyncGenerator<ChatGenerationChunk> {
        const completionUrl = `openai/deployments/${params.model}/chat/completions?api-version=${this._pluginConfig[params.model].modelVersion}`

        const requestContext = createRequestContext(
            this.ctx,
            this._config.value,
            this._pluginConfig,
            this._plugin,
            this
        )

        yield* completionStream(requestContext, params, completionUrl)
    }

    async embeddings(
        params: EmbeddingsRequestParams
    ): Promise<number[] | number[][]> {
        const embeddingsUrl = `openai/deployments/${params.model}/embeddings?api-version=${this._pluginConfig[params.model].modelVersion}`

        const requestContext = createRequestContext(
            this.ctx,
            this._config.value,
            this._pluginConfig,
            this._plugin,
            this
        )

        return await createEmbeddings(requestContext, params, embeddingsUrl)
    }

    public buildHeaders() {
        return {
            'api-key': this._config.value.apiKey,
            'Content-Type': 'application/json'
        }
    }

    public concatUrl(url: string): string {
        const apiEndPoint = this._config.value.apiEndpoint

        if (apiEndPoint.endsWith('/')) {
            return apiEndPoint + url
        }

        return apiEndPoint + '/' + url
    }

    get logger() {
        return logger
    }
}
