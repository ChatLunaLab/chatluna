import { ChatGeneration, ChatGenerationChunk } from '@langchain/core/outputs'
import {
    EmbeddingsRequester,
    EmbeddingsRequestParams,
    ModelRequester,
    ModelRequestParams
} from 'koishi-plugin-chatluna/llm-core/platform/api'
import {
    ClientConfig,
    ClientConfigPool
} from 'koishi-plugin-chatluna/llm-core/platform/config'
import { Config, logger } from '.'
import { ChatLunaPlugin } from 'koishi-plugin-chatluna/services/chat'
import { Context } from 'koishi'
import {
    completion,
    completionStream,
    createEmbeddings,
    createRequestContext,
    getModels
} from '@chatluna/v1-shared-adapter'
import { BaseMessageChunk } from '@langchain/core/messages'
import { RunnableConfig } from '@langchain/core/runnables'

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

    async completion(params: ModelRequestParams): Promise<ChatGeneration> {
        if (!this._pluginConfig.nonStreaming) {
            return super.completion(params)
        }

        const requestContext = createRequestContext(
            this.ctx,
            this._config.value,
            this._pluginConfig,
            this._plugin,
            this
        )

        return completion(
            requestContext,
            params,
            'chat/completions',
            this._pluginConfig.googleSearch &&
                this._pluginConfig.googleSearchSupportModel.includes(
                    params.model
                )
        )
    }

    async *completionStream(
        params: ModelRequestParams
    ): AsyncGenerator<ChatGenerationChunk> {
        if (!this._pluginConfig.nonStreaming) {
            yield* super.completionStream(params)
            return
        }

        const generation = await this.completion(params)

        yield new ChatGenerationChunk({
            generationInfo: generation.generationInfo,
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            message: generation.message as any as BaseMessageChunk,
            text: generation.text
        })
    }

    async *completionStreamInternal(
        params: ModelRequestParams
    ): AsyncGenerator<ChatGenerationChunk> {
        const requestContext = createRequestContext(
            this.ctx,
            this._config.value,
            this._pluginConfig,
            this._plugin,
            this
        )

        yield* completionStream(
            requestContext,
            params,
            'chat/completions',
            this._pluginConfig.googleSearch &&
                this._pluginConfig.googleSearchSupportModel.includes(
                    params.model
                )
        )
    }

    async embeddings(
        params: EmbeddingsRequestParams
    ): Promise<number[] | number[][]> {
        const requestContext = createRequestContext(
            this.ctx,
            this._config.value,
            this._pluginConfig,
            this._plugin,
            this
        )

        return await createEmbeddings(requestContext, params)
    }

    async getModels(config?: RunnableConfig): Promise<string[]> {
        const requestContext = createRequestContext(
            this.ctx,
            this._config.value,
            this._pluginConfig,
            this._plugin,
            this
        )

        return await getModels(requestContext, config)
    }

    get logger() {
        return logger
    }

    public buildHeaders() {
        const result = {
            Authorization: `Bearer ${this._config.value.apiKey}`,
            'Content-Type': 'application/json',
            'HTTP-Referer': 'https://github.com/ChatLunaLab/chatluna', // Optional. Site URL for rankings on openrouter.ai.
            'X-Title': 'ChatLuna' // Optional. Site title for rankings on openrouter.ai.
        }

        if (Object.keys(this._pluginConfig.additionCookies).length > 0) {
            result['Cookie'] = Object.keys(this._pluginConfig.additionCookies)
                .map((key) => {
                    return `${key}=${this._pluginConfig.additionCookies[key]}`
                })
                .join('; ')
        }

        return result
    }
}
