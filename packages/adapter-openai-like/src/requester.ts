import { ChatGeneration, ChatGenerationChunk } from '@langchain/core/outputs'
import {
    EmbeddingsRequester,
    EmbeddingsRequestParams,
    EmbeddingsResult,
    ModelRequester,
    ModelRequestParams,
    RerankerRequester,
    RerankerRequestParams,
    RerankerResult,
    RerankerUsageResult
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
    createRerank,
    getModels,
    responseApiCompletion,
    responseApiCompletionStream,
    type ResponseBuiltinTool,
    ResponseImageProvider
} from '@chatluna/v1-shared-adapter'
import { BaseMessageChunk } from '@langchain/core/messages'
import { RunnableConfig } from '@langchain/core/runnables'
import { hashString } from 'koishi-plugin-chatluna/utils/string'
import type {} from 'koishi-plugin-chatluna-storage-service'

export class OpenAIRequester
    extends ModelRequester
    implements EmbeddingsRequester, RerankerRequester
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
        if (
            !this._pluginConfig.nonStreaming &&
            !this._pluginConfig.responseApi
        ) {
            return super.completion(params)
        }

        const requestContext = createRequestContext(
            this.ctx,
            this._config.value,
            this._pluginConfig,
            this._plugin,
            this
        )

        if (this._pluginConfig.responseApi) {
            return responseApiCompletion(
                requestContext,
                params,
                {
                    googleSearch:
                        this._pluginConfig.googleSearch &&
                        this._pluginConfig.googleSearchSupportModel.includes(
                            params.model
                        ),
                    builtinTools: this._responseBuiltinTools(params)
                },
                true,
                this._imageProvider()
            )
        }

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

        if (this._pluginConfig.responseApi) {
            yield* responseApiCompletionStream(
                requestContext,
                params,
                {
                    googleSearch:
                        this._pluginConfig.googleSearch &&
                        this._pluginConfig.googleSearchSupportModel.includes(
                            params.model
                        ),
                    builtinTools: this._responseBuiltinTools(params)
                },
                true,
                this._imageProvider()
            )
            return
        }

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
    ): Promise<EmbeddingsResult> {
        const requestContext = createRequestContext(
            this.ctx,
            this._config.value,
            this._pluginConfig,
            this._plugin,
            this
        )

        return await createEmbeddings(requestContext, params)
    }

    async rerank(
        params: RerankerRequestParams
    ): Promise<RerankerResult[] | RerankerUsageResult> {
        const requestContext = createRequestContext(
            this.ctx,
            this._config.value,
            this._pluginConfig,
            this._plugin,
            this
        )

        return await createRerank(requestContext, params)
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

    private _responseBuiltinTools(
        params: ModelRequestParams
    ): ResponseBuiltinTool[] {
        if (
            !this._pluginConfig.responseBuiltinToolSupportModel.includes(
                params.model
            )
        ) {
            return []
        }

        const result: ResponseBuiltinTool[] = []

        for (const type of this._pluginConfig.responseBuiltinTools) {
            if (type === 'file_search') {
                if (
                    this._pluginConfig.responseFileSearchVectorStoreIds.length >
                    0
                ) {
                    result.push({
                        type,
                        vector_store_ids:
                            this._pluginConfig.responseFileSearchVectorStoreIds
                    })
                }
                continue
            }

            if (type === 'code_interpreter') {
                result.push({
                    type,
                    container: { type: 'auto' }
                })
                continue
            }

            result.push({ type })
        }

        return result
    }

    get logger() {
        return logger
    }

    private _imageProvider(): ResponseImageProvider {
        return async (item) => {
            const storage = this.ctx.chatluna_storage
            const format =
                item.output_format === 'png' ||
                item.output_format === 'jpeg' ||
                item.output_format === 'webp'
                    ? item.output_format
                    : 'png'
            const ext = format === 'jpeg' ? 'jpg' : format
            const mime = format === 'jpeg' ? 'image/jpeg' : `image/${format}`

            if (!storage) {
                return `data:${mime};base64,${item.result}`
            }

            const file = await storage.createTempFile(
                Buffer.from(item.result as string, 'base64'),
                `${await hashString(item.result as string, 8)}.${ext}`
            )

            return file.url
        }
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
