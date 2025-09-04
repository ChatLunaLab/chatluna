import { AIMessageChunk } from '@langchain/core/messages'
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
import {
    ChatLunaError,
    ChatLunaErrorCode
} from 'koishi-plugin-chatluna/utils/error'
import { checkResponse, sse } from 'koishi-plugin-chatluna/utils/sse'
import { readableStreamToAsyncIterable } from 'koishi-plugin-chatluna/utils/stream'
import { Context } from 'koishi'
import {
    OllamaDeltaResponse,
    OllamaEmbedResponse,
    OllamaRequest
} from './types'
import { langchainMessageToOllamaMessage } from './utils'
import { ChatLunaPlugin } from 'koishi-plugin-chatluna/services/chat'
import { Config, logger as pluginLogger } from '.'

export class OllamaRequester
    extends ModelRequester<ClientConfig>
    implements EmbeddingsRequester
{
    constructor(
        ctx: Context,
        _configPool: ClientConfigPool<ClientConfig>,
        public _plugin: ChatLunaPlugin<ClientConfig, Config>
    ) {
        super(ctx, _configPool, undefined, _plugin)
    }

    async *completionStreamInternal(
        params: ModelRequestParams
    ): AsyncGenerator<ChatGenerationChunk> {
        try {
            const response = await this.post(
                'api/chat',
                {
                    model: params.model,
                    messages: await langchainMessageToOllamaMessage(
                        params.input,
                        this._plugin,
                        this._plugin.config.supportImageModels.includes(
                            params.model
                        )
                    ),
                    keep_alive: this._plugin.config.keepAlive ? -1 : undefined,
                    options: {
                        temperature: params.temperature,
                        // top_k: params.n,
                        top_p: params.topP,
                        stop:
                            typeof params.stop === 'string'
                                ? params.stop
                                : params.stop?.[0]
                    },
                    stream: true
                } satisfies OllamaRequest,
                {
                    signal: params.signal
                }
            )

            const stream = new TransformStream<string, OllamaDeltaResponse>()

            const iterable = readableStreamToAsyncIterable<OllamaDeltaResponse>(
                stream.readable
            )

            const writable = stream.writable.getWriter()

            let buffer = ''

            await checkResponse(response)

            sse(
                response,
                async (rawData) => {
                    buffer += rawData

                    const parts = buffer.split('\n')

                    buffer = parts.pop() ?? ''

                    for (const part of parts) {
                        try {
                            writable.write(JSON.parse(part))
                        } catch (error) {
                            console.warn('invalid json: ', part)
                        }
                    }
                },
                0
            )

            for await (const chunk of iterable) {
                try {
                    const content = chunk.message.content

                    const generationChunk = new ChatGenerationChunk({
                        message: new AIMessageChunk(content),
                        text: content
                    })
                    yield generationChunk

                    if (chunk.done) {
                        return
                    }
                } catch (e) {
                    throw new ChatLunaError(
                        ChatLunaErrorCode.API_REQUEST_FAILED,
                        new Error(
                            'error when calling ollama completion, Result: ' +
                                chunk
                        )
                    )
                }
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
        let data: OllamaEmbedResponse | string

        try {
            const response = await this.post('api/embed', {
                input: params.input,
                model: params.model,
                keep_alive: this._plugin.config.keepAlive ? -1 : undefined
            })

            data = await response.text()

            data = JSON.parse(data as string) as OllamaEmbedResponse

            if (data.embeddings && data.embeddings.length > 0) {
                if (typeof params.input === 'string') {
                    return data.embeddings[0]
                }
                return data.embeddings
            }

            throw new Error(
                'error when calling ollama embeddings, Result: ' +
                    JSON.stringify(data)
            )
        } catch (e) {
            const error = new Error(
                'error when calling ollama embeddings, Result: ' +
                    JSON.stringify(data)
            )

            throw new ChatLunaError(ChatLunaErrorCode.API_REQUEST_FAILED, error)
        }
    }

    async getModels(): Promise<string[]> {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        let data: any
        try {
            const response = await this.get('api/tags')
            data = await response.text()
            data = JSON.parse(data as string)

            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            return (<Record<string, any>[]>data.models).map(
                (model) => model.name
            )
        } catch (e) {
            const error = new Error(
                'error when listing ollama models, Result: ' +
                    JSON.stringify(data)
            )

            error.stack = e.stack
            error.cause = e.cause

            throw error
        }
    }

    concatUrl(url: string): string {
        const apiEndPoint = this._config.value.apiEndpoint

        if (apiEndPoint.endsWith('/')) {
            return apiEndPoint + url
        }

        return apiEndPoint + '/' + url
    }

    get logger() {
        return pluginLogger
    }
}
