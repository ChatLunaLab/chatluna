import { ChatGenerationChunk } from '@langchain/core/outputs'
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
    completionStream,
    createEmbeddings,
    createRequestContext,
    responseApiCompletionStream,
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
                false,
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

            if (!storage) {
                return `data:image/png;base64,${item.result}`
            }

            const file = await storage.createTempFile(
                Buffer.from(item.result as string, 'base64'),
                `${await hashString(item.result as string, 8)}.png`
            )

            return file.url
        }
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

            const error = new Error(
                'error when listing openai models, Result: ' +
                    JSON.stringify(data)
            )
            throw error
        }
    }

    get logger() {
        return logger
    }
}
