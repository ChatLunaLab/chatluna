import {
    EmbeddingsRequester,
    EmbeddingsRequestParams,
    ModelRequester,
    ModelRequestParams
} from 'koishi-plugin-chatluna/src/llm-core/platform/api'
import { ClientConfig } from 'koishi-plugin-chatluna/src/llm-core/platform/config'
import * as fetchType from 'undici/types/fetch'
import { ChatGenerationChunk } from '@langchain/core/outputs'
import {
    ChatCompletionRequestMessageToolCall,
    ChatCompletionResponse,
    ChatCompletionResponseMessageRoleEnum,
    CreateEmbeddingResponse
} from './types'
import {
    ChatLunaError,
    ChatLunaErrorCode
} from 'koishi-plugin-chatluna/src/utils/error'
import { sseIterable } from 'koishi-plugin-chatluna/src/utils/sse'
import {
    convertDeltaToMessageChunk,
    formatToolsToOpenAITools,
    langchainMessageToOpenAIMessage
} from './utils'
import { chatLunaFetch } from 'koishi-plugin-chatluna/src/utils/request'
import { logger } from '.'

export class OpenAIRequester
    extends ModelRequester
    implements EmbeddingsRequester
{
    constructor(private _config: ClientConfig) {
        super()
    }

    async *completionStream(
        params: ModelRequestParams
    ): AsyncGenerator<ChatGenerationChunk> {
        try {
            const response = await this._post(
                'chat/completions',
                {
                    model: params.model,
                    messages: langchainMessageToOpenAIMessage(
                        params.input,
                        params.model
                    ),
                    tools:
                        params.tools != null
                            ? formatToolsToOpenAITools(params.tools)
                            : undefined,
                    stop: params.stop,
                    // remove max_tokens
                    max_tokens: params.model.includes('vision')
                        ? undefined
                        : params.maxTokens,
                    temperature: params.temperature,
                    presence_penalty: params.presencePenalty,
                    frequency_penalty: params.frequencyPenalty,
                    n: params.n,
                    top_p: params.topP,
                    user: params.user ?? 'user',
                    stream: true,
                    logit_bias: params.logitBias
                },
                {
                    signal: params.signal
                }
            )

            const iterator = sseIterable(response)
            let content = ''
            const toolCall: ChatCompletionRequestMessageToolCall[] = []

            let defaultRole: ChatCompletionResponseMessageRoleEnum = 'assistant'

            let errorCount = 0

            for await (const event of iterator) {
                const chunk = event.data
                if (chunk === '[DONE]') {
                    return
                }

                try {
                    const data = JSON.parse(chunk) as ChatCompletionResponse

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
                    const messageChunk = convertDeltaToMessageChunk(
                        delta,
                        defaultRole
                    )

                    messageChunk.content = content + messageChunk.content
                    const deltaToolCall =
                        messageChunk.additional_kwargs.tool_calls

                    if (deltaToolCall != null) {
                        for (
                            let index = 0;
                            index < deltaToolCall.length;
                            index++
                        ) {
                            const oldTool = toolCall[index]

                            const deltaTool = deltaToolCall[index]

                            if (oldTool == null) {
                                toolCall[index] = deltaTool
                                continue
                            }

                            if (deltaTool == null) {
                                continue
                            }

                            if (deltaTool.id != null) {
                                oldTool.id = (oldTool?.id ?? '') + deltaTool.id
                            }

                            if (deltaTool.type != null) {
                                // TODO: streaming
                                oldTool.type = 'function'
                            }

                            if (deltaTool.function != null) {
                                if (oldTool.function == null) {
                                    oldTool.function = deltaTool.function
                                    continue
                                }

                                if (deltaTool.function.arguments != null) {
                                    oldTool.function.arguments =
                                        (oldTool.function.arguments ?? '') +
                                        deltaTool.function.arguments
                                }

                                if (deltaTool.function.name != null) {
                                    oldTool.function.name =
                                        (oldTool.function.name ?? '') +
                                        deltaTool.function.name
                                }
                            }

                            // logger.debug(deltaTool, oldTool)
                        }
                    }

                    if (toolCall.length > 0) {
                        messageChunk.additional_kwargs.tool_calls = toolCall
                    }

                    defaultRole = (delta.role ??
                        defaultRole) as ChatCompletionResponseMessageRoleEnum

                    const generationChunk = new ChatGenerationChunk({
                        message: messageChunk,
                        text: messageChunk.content
                    })

                    yield generationChunk
                    content = messageChunk.content
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
            const response = await this._post('embeddings', {
                input: params.input,
                model: params.model
            })

            data = await response.text()

            data = JSON.parse(data) as CreateEmbeddingResponse

            if (data.data && data.data.length > 0) {
                return (data as CreateEmbeddingResponse).data.map(
                    (it) => it.embedding
                )
            }

            throw new Error(
                'error when calling openai embeddings, Result: ' +
                    JSON.stringify(data)
            )
        } catch (e) {
            const error = new Error(
                'error when calling openai embeddings, Result: ' +
                    JSON.stringify(data)
            )

            error.stack = e.stack
            error.cause = e.cause
            logger.debug(e)

            throw new ChatLunaError(ChatLunaErrorCode.API_REQUEST_FAILED, error)
        }
    }

    async getModels(): Promise<string[]> {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        let data: any
        try {
            const response = await this._get('models')
            data = await response.text()
            data = JSON.parse(data as string)

            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            return (<Record<string, any>[]>data.data).map((model) => model.id)
        } catch (e) {
            const error = new Error(
                'error when listing openai models, Result: ' +
                    JSON.stringify(data)
            )

            error.stack = e.stack
            error.cause = e.cause

            throw error
        }
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    private _post(url: string, data: any, params: fetchType.RequestInit = {}) {
        const requestUrl = this._concatUrl(url)

        for (const key in data) {
            if (data[key] === undefined) {
                delete data[key]
            }
        }

        const body = JSON.stringify(data)

        // console.log('POST', requestUrl, body)

        return chatLunaFetch(requestUrl, {
            body,
            headers: this._buildHeaders(),
            method: 'POST',
            ...params
        })
    }

    private _get(url: string) {
        const requestUrl = this._concatUrl(url)

        return chatLunaFetch(requestUrl, {
            method: 'GET',
            headers: this._buildHeaders()
        })
    }

    private _buildHeaders() {
        return {
            Authorization: `Bearer ${this._config.apiKey}`,
            'Content-Type': 'application/json'
        }
    }

    private _concatUrl(url: string): string {
        const apiEndPoint = this._config.apiEndpoint

        // match the apiEndPoint ends with '/v1' or '/v1/' using regex
        if (!apiEndPoint.match(/\/v1\/?$/)) {
            if (apiEndPoint.endsWith('/')) {
                return apiEndPoint + 'v1/' + url
            }

            return apiEndPoint + '/v1/' + url
        }

        if (apiEndPoint.endsWith('/')) {
            return apiEndPoint + url
        }

        return apiEndPoint + '/' + url
    }

    async init(): Promise<void> {}

    async dispose(): Promise<void> {}
}
