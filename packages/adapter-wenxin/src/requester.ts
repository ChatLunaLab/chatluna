import { ChatGenerationChunk } from '@langchain/core/outputs'
import {
    buildChatCompletionParams,
    createEmbeddings,
    createRequestContext,
    processStreamResponse
} from '@chatluna/v1-shared-adapter'
import { Context } from 'koishi'
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
import { ChatLunaPlugin } from 'koishi-plugin-chatluna/services/chat'
import {
    ChatLunaError,
    ChatLunaErrorCode
} from 'koishi-plugin-chatluna/utils/error'
import { sseIterable } from 'koishi-plugin-chatluna/utils/sse'
import { Config, logger } from '.'
import {
    formatToolsToWenxinTools,
    langchainMessageToWenXinMessage
} from './utils'
import { WenxinChatRequest } from './types'

export class WenxinRequester
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

        const request = (await buildChatCompletionParams(
            params,
            this._plugin,
            false,
            false
        )) as WenxinChatRequest

        request.messages = await langchainMessageToWenXinMessage(
            params.input,
            this._plugin,
            params.model
        )
        request.temperature = params.temperature
        request.top_p = params.topP
        request.penalty_score = params.presencePenalty
        request.disable_search = !this._pluginConfig.enableSearch
        request.functions =
            params.tools == null
                ? undefined
                : formatToolsToWenxinTools(params.tools)

        delete request.stop
        delete request.tools
        delete request.max_tokens
        delete request.presence_penalty
        delete request.frequency_penalty
        delete request.n
        delete request.prompt_cache_key
        delete request.prompt_cache_retention
        delete request.prediction
        delete request.reasoning_effort
        delete request.response_format
        delete request.safety_identifier
        delete request.service_tier
        delete request.stream_options
        delete request.logit_bias

        try {
            const response = await this.post('v2/chat/completions', request, {
                signal: params.signal
            })

            yield* processStreamResponse(
                requestContext,
                sseIterable(response, params.timeout, params.signal)
            )
        } catch (e) {
            if (e instanceof ChatLunaError) {
                throw e
            }

            throw new ChatLunaError(ChatLunaErrorCode.API_REQUEST_FAILED, e)
        }
    }

    async embeddings(
        params: EmbeddingsRequestParams
    ): Promise<EmbeddingsResult> {
        if (
            typeof params.input === 'string' &&
            params.input.trim().length < 1
        ) {
            return []
        }

        const requestContext = createRequestContext(
            this.ctx,
            this._config.value,
            this._pluginConfig,
            this._plugin,
            this
        )

        const data = await createEmbeddings(
            requestContext,
            {
                ...params,
                input: Array.isArray(params.input)
                    ? params.input
                    : [params.input]
            },
            'v2/embeddings'
        )
        const result = (Array.isArray(data) ? data : data.data) as number[][]

        if (Array.isArray(params.input)) {
            return data
        }

        return Array.isArray(data)
            ? result[0]
            : {
                  data: result[0],
                  usage: data.usage
              }
    }

    concatUrl(url: string): string {
        return `https://qianfan.baidubce.com/${url}`
    }

    buildHeaders() {
        return {
            'Content-Type': 'application/json',
            appid: '',
            Authorization: `Bearer ${this._config.value.apiKey}`
        }
    }

    get logger() {
        return logger
    }
}
