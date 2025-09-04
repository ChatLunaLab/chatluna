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
import { logger } from '.'
import { ChatLunaPlugin } from 'koishi-plugin-chatluna/services/chat'
import { Context } from 'koishi'
import {
    buildChatCompletionParams,
    createEmbeddings,
    createRequestContext,
    processStreamResponse
} from '@chatluna/v1-shared-adapter'
import * as fetchType from 'undici/types/fetch'
import { sseIterable } from 'koishi-plugin-chatluna/utils/sse'
import {
    ChatLunaError,
    ChatLunaErrorCode
} from 'koishi-plugin-chatluna/utils/error'

export class DoubaoRequester
    extends ModelRequester
    implements EmbeddingsRequester
{
    constructor(
        ctx: Context,
        _configPool: ClientConfigPool<ClientConfig>,
        _pluginConfig: ChatLunaPlugin.Config,
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

        let model = params.model
        let enabledThinking: boolean | undefined = null

        if (model.includes('thinking') && model.slice(-8) === 'thinking') {
            enabledThinking = !model.includes('-non-thinking')
            model = model
                .replace('-non-thinking', '-thinking')
                .replace('-thinking', '')
        } else if (
            model.includes('thinking') &&
            model.slice(-8) !== 'thinking'
        ) {
            enabledThinking = true
        }

        const baseRequest = buildChatCompletionParams(
            { ...params, model },
            this._plugin,
            false,
            false
        ) as ReturnType<typeof buildChatCompletionParams> & {
            thinking?: {
                type: 'enabled' | 'disabled'
            }
        }

        if (enabledThinking !== null) {
            baseRequest.thinking = {
                type: enabledThinking ? 'enabled' : 'disabled'
            }
        }

        // Make the request using the shared post method

        // Use shared stream processing

        try {
            const response = await this.post('chat/completions', baseRequest, {
                signal: params.signal
            })

            const iterator = sseIterable(response)
            yield* processStreamResponse(requestContext, iterator)
        } catch (e) {
            if (e instanceof ChatLunaError) {
                throw e
            } else {
                throw new ChatLunaError(ChatLunaErrorCode.API_REQUEST_FAILED, e)
            }
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

    private _concatUrl(url: string): string {
        const apiEndPoint = this._config.value.apiEndpoint

        // match the apiEndPoint ends with '/v3' or '/v3/' using regex
        if (!apiEndPoint.match(/\/v3\/?$/)) {
            if (apiEndPoint.endsWith('/')) {
                return apiEndPoint + 'v3/' + url
            }

            return apiEndPoint + '/v3/' + url
        }

        if (apiEndPoint.endsWith('/')) {
            return apiEndPoint + url
        }

        return apiEndPoint + '/' + url
    }

    post(
        url: string,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        data: any,
        params: fetchType.RequestInit = {}
    ) {
        const requestUrl = this._concatUrl(url)

        for (const key in data) {
            if (data[key] === undefined) {
                delete data[key]
            }
        }

        const body = JSON.stringify(data)

        return this._plugin.fetch(requestUrl, {
            body,
            headers: this._buildHeaders(),
            method: 'POST',
            ...params
        })
    }

    get(url: string) {
        const requestUrl = this._concatUrl(url)

        return this._plugin.fetch(requestUrl, {
            method: 'GET',
            headers: this._buildHeaders()
        })
    }

    private _buildHeaders() {
        return {
            Authorization: `Bearer ${this._config.value.apiKey}`,
            'Content-Type': 'application/json'
        }
    }

    get logger() {
        return logger
    }
}
