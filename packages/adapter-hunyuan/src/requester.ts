import { ChatGenerationChunk } from '@langchain/core/outputs'
import {
    buildChatCompletionParams,
    createEmbeddings,
    createRequestContext,
    processStreamResponse,
    supportImageInput
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
import { SSEEvent, sseIterable } from 'koishi-plugin-chatluna/utils/sse'
import { Config, logger as pluginLogger } from '.'
import { ChatCompletionResponse, HunyuanChatRequest } from './types'
import {
    formatToolsToHunyuanTools,
    langchainMessageToHunyuanMessage
} from './utils'

// eslint-disable-next-line generator-star-spacing
async function* validateHunyuanStream(
    iterator: AsyncGenerator<SSEEvent, string, unknown>
) {
    for await (const event of iterator) {
        const chunk = event.data

        if (
            chunk === '[DONE]' ||
            chunk == null ||
            chunk === '' ||
            chunk === 'undefined'
        ) {
            yield event
            continue
        }

        try {
            const data = JSON.parse(chunk) as ChatCompletionResponse & {
                Response?: {
                    Error?: {
                        Code?: string
                        Message?: string
                    }
                }
                Error?: {
                    code?: string
                    Code?: string
                    message?: string
                    Message?: string
                }
            }
            const err = data.Response?.Error ?? data.Error

            if (err != null) {
                const code = err.Code ?? err['code'] ?? ''
                const msg = err.Message ?? err['message'] ?? ''

                if (
                    code.includes('IllegalDetected') ||
                    msg.includes('IllegalDetected')
                ) {
                    throw new ChatLunaError(
                        ChatLunaErrorCode.API_UNSAFE_CONTENT,
                        new Error(
                            'Unsafe content detected, please try again.' + chunk
                        )
                    )
                }

                throw new ChatLunaError(
                    ChatLunaErrorCode.API_REQUEST_FAILED,
                    new Error(
                        'error when calling Hunyuan completion, Result: ' +
                            chunk
                    )
                )
            }
        } catch (e) {
            if (e instanceof ChatLunaError) {
                throw e
            }
        }

        yield event
    }

    return ''
}

export class HunyuanRequester
    extends ModelRequester<ClientConfig>
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
        const isVisionModel = supportImageInput(params.model)
        const request = (await buildChatCompletionParams(
            {
                ...params,
                tools: isVisionModel ? undefined : params.tools
            },
            this._plugin,
            false,
            false
        )) as HunyuanChatRequest

        request.messages = await langchainMessageToHunyuanMessage(
            params.input,
            this._plugin,
            params.model
        )
        request.tools =
            params.tools != null && !isVisionModel
                ? formatToolsToHunyuanTools(params.tools)
                : undefined
        request.enable_enhancement = isVisionModel
            ? undefined
            : this._pluginConfig.enableSearch

        delete request.stop
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
        delete request.logit_bias
        delete request.stream_options

        try {
            const response = await this.post('chat/completions', request, {
                signal: params.signal
            })

            yield* processStreamResponse(
                requestContext,
                validateHunyuanStream(sseIterable(response, params))
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
        const requestContext = createRequestContext(
            this.ctx,
            this._config.value,
            this._pluginConfig,
            this._plugin,
            this
        )

        return await createEmbeddings(requestContext, params)
    }

    concatUrl(url: string): string {
        return 'https://api.hunyuan.cloud.tencent.com/v1/' + url
    }

    get logger() {
        return pluginLogger
    }
}
