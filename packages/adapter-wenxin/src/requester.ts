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
import * as fetchType from 'undici/types/fetch'
import { ChatGenerationChunk } from '@langchain/core/outputs'
import {
    CreateEmbeddingResponse,
    WenxinMessage,
    WenxinMessageRole
} from './types'
import {
    ChatLunaError,
    ChatLunaErrorCode
} from 'koishi-plugin-chatluna/utils/error'
import { sseIterable } from 'koishi-plugin-chatluna/utils/sse'
import {
    convertDeltaToMessageChunk,
    formatToolsToWenxinTools,
    langchainMessageToWenXinMessage
} from './utils'
import { Config, logger } from '.'
import { ChatLunaPlugin } from 'koishi-plugin-chatluna/services/chat'
import { Context } from 'koishi'
import { AIMessageChunk } from '@langchain/core/messages'

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
        await this.init()

        const messagesMapped: WenxinMessage[] =
            await langchainMessageToWenXinMessage(
                params.input,
                this._plugin,
                params.model
            )

        try {
            const response = await this._post(
                'v2/chat/completions',
                {
                    messages: messagesMapped,
                    stream: true,
                    temperature: params.temperature,
                    top_p: params.topP,
                    penalty_score: params.presencePenalty,
                    disable_search: !this._pluginConfig.enableSearch,

                    model: params.model,
                    functions:
                        params.tools != null
                            ? formatToolsToWenxinTools(params.tools)
                            : undefined
                },
                {
                    signal: params.signal
                }
            )

            const iterator = sseIterable(response)

            let defaultRole: WenxinMessageRole = 'assistant'

            let errorCount = 0

            const reasoningState = {
                content: '',
                startedAt: Date.now(),
                endedAt: undefined as number | undefined
            }

            for await (const event of iterator) {
                const chunk = event.data
                if (chunk === '[DONE]') {
                    break
                }

                try {
                    const data = JSON.parse(chunk)

                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    if ((data as any).error) {
                        throw new ChatLunaError(
                            ChatLunaErrorCode.API_REQUEST_FAILED,
                            new Error(
                                'error when calling openai completion, Result: ' +
                                    chunk
                            )
                        )
                    }

                    const choice = data.choices?.[0]
                    if (!choice) {
                        continue
                    }

                    const { delta } = choice
                    const hasResult =
                        (delta.content?.length ?? 0) > 0 ||
                        (delta.tool_calls?.length ?? 0) > 0 ||
                        delta.function_call != null

                    if (reasoningState.endedAt == null && hasResult) {
                        reasoningState.endedAt = Date.now()
                    }

                    if (
                        reasoningState.endedAt == null &&
                        !hasResult &&
                        delta.reasoning_content
                    ) {
                        reasoningState.content += delta.reasoning_content
                    }

                    const messageChunk = convertDeltaToMessageChunk(
                        {
                            ...delta,
                            reasoning_content: undefined
                        },
                        defaultRole
                    )

                    const hasMessageChunk =
                        (typeof messageChunk.content === 'string'
                            ? messageChunk.content.length > 0
                            : Array.isArray(messageChunk.content) &&
                              messageChunk.content.length > 0) ||
                        (messageChunk instanceof AIMessageChunk &&
                            (messageChunk.tool_call_chunks?.length ?? 0) > 0) ||
                        messageChunk.additional_kwargs.function_call != null

                    if (!hasMessageChunk) {
                        defaultRole = (
                            (delta.role?.length ?? 0) > 0
                                ? delta.role
                                : defaultRole
                        ) as WenxinMessageRole
                        continue
                    }

                    defaultRole = (
                        (delta.role?.length ?? 0) > 0 ? delta.role : defaultRole
                    ) as WenxinMessageRole

                    const generationChunk = new ChatGenerationChunk({
                        message: messageChunk,
                        text: messageChunk.content as string
                    })

                    yield generationChunk
                } catch (e) {
                    if (errorCount > 5) {
                        logger.error('error with chunk', chunk)
                        throw new ChatLunaError(
                            ChatLunaErrorCode.API_REQUEST_FAILED,
                            e
                        )
                    } else {
                        errorCount++
                        continue
                    }
                }
            }

            if (reasoningState.content.length > 0) {
                const reasoningTime =
                    (reasoningState.endedAt ?? Date.now()) -
                    reasoningState.startedAt

                yield new ChatGenerationChunk({
                    message: new AIMessageChunk({
                        content: '',
                        additional_kwargs: {
                            reasoning_content: reasoningState.content,
                            ...(reasoningTime != null
                                ? { reasoning_time: reasoningTime }
                                : {})
                        }
                    }),
                    text: ''
                })

                logger.debug(
                    `reasoning content: ${reasoningState.content}. Use time: ${(reasoningTime ?? 0) / 1000} s.`
                )
            }
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
        await this.init()

        if (
            typeof params.input === 'string' &&
            params.input.trim().length < 1
        ) {
            return []
        }

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        let data: CreateEmbeddingResponse | string

        try {
            const response = await this._post(`v2/embeddings`, {
                input:
                    params.input instanceof Array
                        ? params.input
                        : [params.input],
                model: params.model
            })

            data = await response.text()

            data = JSON.parse(data) as CreateEmbeddingResponse

            if (data.data && data.data.length > 0) {
                const rawEmbeddings = (
                    data as CreateEmbeddingResponse
                ).data.map((it) => it.embedding)

                if (params.input instanceof Array) {
                    return rawEmbeddings
                }

                return rawEmbeddings[0]
            }

            throw new Error(
                'error when calling wenxin embeddings, Result: ' +
                    JSON.stringify(data)
            )
        } catch (e) {
            const error = new Error(
                'error when calling wenxin embeddings, Result: ' +
                    JSON.stringify(data)
            )

            error.stack = e.stack
            error.cause = e.cause

            throw new ChatLunaError(ChatLunaErrorCode.API_REQUEST_FAILED, error)
        }
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    private _post(url: string, data: any, params: fetchType.RequestInit = {}) {
        const body = JSON.stringify(data)

        return this._plugin.fetch(`https://qianfan.baidubce.com/${url}`, {
            body,
            headers: this._buildHeaders(),
            method: 'POST',
            ...params
        })
    }

    private _buildHeaders() {
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
