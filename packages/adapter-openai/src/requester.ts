import { ChatGenerationChunk } from '@langchain/core/outputs'
import {
    EmbeddingsRequester,
    EmbeddingsRequestParams,
    EmbeddingsResult,
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
    completionStream,
    createEmbeddings,
    createRequestContext,
    responseApiCompletionStream,
    type ResponseBuiltinTool,
    ResponseImageProvider
} from '@chatluna/v1-shared-adapter'
import { RunnableConfig } from '@langchain/core/runnables'
import { ChatLunaError } from 'koishi-plugin-chatluna/utils/error'
import { hashString } from 'koishi-plugin-chatluna/utils/string'
import type {} from 'koishi-plugin-chatluna-storage-service'

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
                    builtinTools: this._responseBuiltinTools(params)
                },
                true,
                this._imageProvider()
            )
            return
        }

        yield* completionStream(requestContext, params)
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

    async getModels(config?: RunnableConfig): Promise<string[]> {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        let data: any
        try {
            const response = await this.get(
                'models',
                {},
                { signal: config?.signal }
            )
            data = await response.text()
            data = JSON.parse(data as string)

            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            return (<Record<string, any>[]>data.data).map((model) => model.id)
        } catch (e) {
            if (e instanceof ChatLunaError) {
                throw e
            }

            const raw = data?.error?.message ?? data?.error ?? data
            if (raw == null) {
                throw new Error(e instanceof Error ? e.message : String(e))
            }

            throw new Error(typeof raw === 'string' ? raw : JSON.stringify(raw))
        }
    }

    get logger() {
        return logger
    }
}
