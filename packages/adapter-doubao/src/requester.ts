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
import { logger } from '.'
import { ChatLunaPlugin } from 'koishi-plugin-chatluna/services/chat'
import { Context } from 'koishi'
import {
    buildChatCompletionParams,
    createEmbeddings,
    createRequestContext,
    parseOpenAIModelNameWithReasoningEffort,
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

        const parsedModel = parseOpenAIModelNameWithReasoningEffort(
            params.model
        )
        const model = parsedModel.model
        let enabledThinking: boolean | undefined

        if (parsedModel.reasoningEffort != null) {
            enabledThinking = parsedModel.reasoningEffort !== 'none'
        }

        if (enabledThinking == null && model.includes('thinking')) {
            enabledThinking = true
        }

        const baseRequest = (await buildChatCompletionParams(
            params,
            this._plugin,
            false,
            [
                'doubao-seed-1-6',
                'vision',
                'doubao-seed-1-8',
                'doubao-seed-2-0'
            ].some((pattern) => model.includes(pattern))
        )) as Awaited<ReturnType<typeof buildChatCompletionParams>> & {
            thinking?: {
                type: 'enabled' | 'disabled'
            }
        }

        if (enabledThinking != null) {
            baseRequest.thinking = {
                type: enabledThinking ? 'enabled' : 'disabled'
            }
        }

        if (parsedModel.reasoningEffort === 'none') {
            delete baseRequest.reasoning_effort
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

    post(
        url: string,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        data: any,
        params: fetchType.RequestInit = {}
    ) {
        const requestUrl = this.concatUrl(url)

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
        const requestUrl = this.concatUrl(url)

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
