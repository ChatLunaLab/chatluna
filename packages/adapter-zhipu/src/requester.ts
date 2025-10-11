import { ChatGenerationChunk } from '@langchain/core/outputs'
import jwt from 'jsonwebtoken'
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
import {
    ChatLunaError,
    ChatLunaErrorCode
} from 'koishi-plugin-chatluna/utils/error'
import { sseIterable } from 'koishi-plugin-chatluna/utils/sse'
import * as fetchType from 'undici/types/fetch'
import {
    ChatCompletionResponse,
    ChatCompletionResponseMessageRoleEnum,
    CreateEmbeddingResponse
} from './types'
import {
    convertDeltaToMessageChunk,
    formatToolsToZhipuTools,
    langchainMessageToZhipuMessage
} from './utils'
import { ChatLunaPlugin } from 'koishi-plugin-chatluna/services/chat'
import { Config, logger } from '.'
import { Context } from 'koishi'
import { AIMessageChunk } from '@langchain/core/messages'

export class ZhipuRequester
    extends ModelRequester
    implements EmbeddingsRequester
{
    constructor(
        ctx: Context,
        _configPool: ClientConfigPool<ClientConfig>,
        _pluginConfig: Config,
        _plugin: ChatLunaPlugin
    ) {
        super(ctx, _configPool, _pluginConfig, _plugin)
    }

    async *completionStreamInternal(
        params: ModelRequestParams
    ): AsyncGenerator<ChatGenerationChunk> {
        try {
            const response = await this._post(
                'https://open.bigmodel.cn/api/paas/v4/chat/completions',
                {
                    model: params.model,
                    messages: await langchainMessageToZhipuMessage(
                        params.input,
                        this._plugin,
                        params.model
                    ),
                    tools: params.model.includes('4V')
                        ? undefined
                        : formatToolsToZhipuTools(
                              params.model,
                              params.tools,
                              this._config.value
                          ),
                    stop: params.stop,
                    // remove max_tokens
                    max_tokens: params.model.includes('4V')
                        ? undefined
                        : params.maxTokens,
                    temperature:
                        params.temperature === 0
                            ? undefined
                            : params.temperature,
                    presence_penalty: params.model.includes('tools')
                        ? undefined
                        : params.presencePenalty === 0
                          ? undefined
                          : params.presencePenalty,
                    frequency_penalty: params.model.includes('tools')
                        ? undefined
                        : params.frequencyPenalty === 0
                          ? undefined
                          : params.frequencyPenalty,
                    n: params.n,
                    top_p: params.topP,
                    user: params.model.includes('tools')
                        ? undefined
                        : (params.user ?? 'user'),
                    stream: true
                },
                {
                    signal: params.signal
                }
            )

            const iterator = sseIterable(response)

            let defaultRole: ChatCompletionResponseMessageRoleEnum = 'assistant'

            let errorCount = 0

            for await (const event of iterator) {
                const chunk = event.data
                if (chunk === '[DONE]') {
                    return
                }

                let data: ChatCompletionResponse

                try {
                    data = JSON.parse(chunk) as ChatCompletionResponse
                } catch (e) {
                    if (errorCount > 10) {
                        throw new ChatLunaError(
                            ChatLunaErrorCode.API_REQUEST_FAILED,
                            e
                        )
                    } else {
                        errorCount++
                        continue
                    }
                }

                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                if ((data as any).error) {
                    throw new ChatLunaError(
                        ChatLunaErrorCode.API_REQUEST_FAILED,
                        new Error(
                            'error when calling zhipu completion, Result: ' +
                                chunk
                        )
                    )
                }

                if (data.usage) {
                    yield new ChatGenerationChunk({
                        message: new AIMessageChunk(''),
                        text: '',
                        generationInfo: {
                            tokenUsage: {
                                promptTokens: data.usage.prompt_tokens,
                                completionTokens: data.usage.completion_tokens,
                                totalTokens: data.usage.total_tokens
                            }
                        }
                    })
                }

                const choice = data.choices?.[0]
                if (!choice) {
                    continue
                }

                const { delta } = choice
                const messageChunk = convertDeltaToMessageChunk(
                    delta,
                    defaultRole
                )

                defaultRole = (delta.role ??
                    defaultRole) as ChatCompletionResponseMessageRoleEnum

                const generationChunk = new ChatGenerationChunk({
                    message: messageChunk,
                    text: messageChunk.content as string
                })

                yield generationChunk
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
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        let data: CreateEmbeddingResponse | string

        try {
            const response = await this._post(
                'https://open.bigmodel.cn/api/paas/v4/embeddings',
                {
                    input: params.input,
                    model: params.model
                }
            )

            data = await response.text()

            data = JSON.parse(data as string) as CreateEmbeddingResponse

            if (data.data && data.data.length > 0) {
                return (data as CreateEmbeddingResponse).data.map(
                    (it) => it.embedding
                )
            }

            throw new Error(
                'error when calling zhipu embeddings, Result: ' +
                    JSON.stringify(data)
            )
        } catch (e) {
            const error = new Error(
                'error when calling zhipu embeddings, Result: ' +
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

        return this._plugin.fetch(url, {
            body,
            headers: this._buildHeaders(),
            method: 'POST',
            ...params
        })
    }

    get logger() {
        return logger
    }

    private _buildHeaders() {
        return {
            Authorization: this._config.value.apiKey,
            'Content-Type': 'application/json',
            accept: 'text/event-stream'
        }
    }

    private _generateToken(rawApiKey: string): string {
        const [apiKey, secret] = rawApiKey.split('.')

        const timestamp = Date.now()
        const payload = {
            api_key: apiKey,
            exp: timestamp + 3 * 60 * 1000,
            timestamp
        }

        return jwt.sign(payload, secret, {
            header: {
                alg: 'HS256',
                sign_type: 'SIGN'
            }
        })
    }

    async init(): Promise<void> {}

    async dispose(): Promise<void> {}
}

declare module 'jsonwebtoken' {
    interface JwtHeader {
        sign_type: string
    }
}
