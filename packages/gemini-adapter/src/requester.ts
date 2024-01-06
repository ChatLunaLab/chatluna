import {
    EmbeddingsRequester,
    EmbeddingsRequestParams,
    ModelRequester,
    ModelRequestParams
} from 'koishi-plugin-chatluna/lib/llm-core/platform/api'
import { ClientConfig } from 'koishi-plugin-chatluna/lib/llm-core/platform/config'
import * as fetchType from 'undici/types/fetch'
import { AIMessageChunk, ChatGenerationChunk } from 'langchain/schema'
import { ChatMessagePart, ChatResponse, CreateEmbeddingResponse } from './types'
import {
    ChatLunaError,
    ChatLunaErrorCode
} from 'koishi-plugin-chatluna/lib/utils/error'
import { sse } from 'koishi-plugin-chatluna/lib/utils/sse'
import { langchainMessageToGeminiMessage } from './utils'
import { chatLunaFetch } from 'koishi-plugin-chatluna/lib/utils/request'
import { logger } from '.'
import { JSONParser } from '@streamparser/json'
import { readableStreamToAsyncIterable } from 'koishi-plugin-chatluna/lib/utils/stream'

export class GeminiRequester
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
                `models/${params.model}:streamGenerateContent`,
                {
                    contents: await langchainMessageToGeminiMessage(
                        params.input,
                        params.model
                    ),
                    safetySettings: [
                        {
                            category: 'HARM_CATEGORY_HARASSMENT',
                            threshold: 'BLOCK_NONE'
                        },
                        {
                            category: 'HARM_CATEGORY_HATE_SPEECH',
                            threshold: 'BLOCK_NONE'
                        },
                        {
                            category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT',
                            threshold: 'BLOCK_NONE'
                        },
                        {
                            category: 'HARM_CATEGORY_DANGEROUS_CONTENT',
                            threshold: 'BLOCK_NONE'
                        }
                    ],
                    generationConfig: {
                        stopSequences: params.stop,
                        temperature: params.temperature,
                        maxOutputTokens: params.model.includes('vision')
                            ? undefined
                            : params.maxTokens,
                        topP: params.topP
                    }
                },
                {
                    signal: params.signal
                }
            )

            let errorCount = 0

            const stream = new TransformStream<string, string>()

            const iterable = readableStreamToAsyncIterable<string>(
                stream.readable
            )

            const jsonParser = new JSONParser()

            const writable = stream.writable.getWriter()

            jsonParser.onEnd = async () => {
                await writable.write('[DONE]')
            }

            jsonParser.onValue = async ({ value }) => {
                const transformValue = value as unknown as ChatResponse

                if (transformValue.candidates && transformValue.candidates[0]) {
                    const parts = transformValue.candidates[0].content
                        .parts as ChatMessagePart[]

                    if (parts.length < 1) {
                        throw new Error(JSON.stringify(value))
                    }

                    const text = parts[0].text
                    logger.debug('text', text)

                    if (text) {
                        await writable.write(text)
                    }
                }
            }

            await sse(response, async (rawData) => {
                logger.debug('chunk', rawData)
                jsonParser.write(rawData)
                return true
            })

            let content = ''

            let isVisionModel = params.model.includes('vision')

            for await (let chunk of iterable) {
                if (chunk === '[DONE]') {
                    return
                }

                // match /w*model:
                if (isVisionModel && /\s*model:\s*/.test(chunk)) {
                    isVisionModel = false
                    chunk = chunk.replace(/\s*model:\s*/, '')
                }

                try {
                    const messageChunk = new AIMessageChunk(chunk)

                    messageChunk.content = content + messageChunk.content

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
            const response = await this._post(
                `models/${params.model}:embedContent`,
                {
                    model: `models/${params.model}`,
                    content: {
                        parts: [
                            {
                                text: params.input
                            }
                        ]
                    }
                }
            )

            data = await response.text()

            data = JSON.parse(data) as CreateEmbeddingResponse

            if (data.embedding && data.embedding.values?.length > 0) {
                return data.embedding.values
            }

            throw new Error(
                'error when calling gemini embeddings, Result: ' +
                    JSON.stringify(data)
            )
        } catch (e) {
            const error = new Error(
                'error when calling gemini embeddings, Result: ' +
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

            if (!data.models || !data.models.length) {
                throw new Error(
                    'error when listing gemini models, Result:' +
                        JSON.stringify(data)
                )
            }

            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            return (<Record<string, any>[]>data.models)
                .map((model) => model.name as string)
                .filter(
                    (model) =>
                        model.includes('gemini') || model.includes('embedding')
                )
        } catch (e) {
            const error = new Error(
                'error when listing gemini models, Result: ' +
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

    private _concatUrl(url: string) {
        const apiEndPoint = this._config.apiEndpoint

        // match the apiEndPoint ends with '/v1' or '/v1/' using regex

        if (apiEndPoint.endsWith('/')) {
            return apiEndPoint + url + `?key=${this._config.apiKey}`
        }

        return apiEndPoint + '/' + url + `?key=${this._config.apiKey}`
    }

    private _buildHeaders() {
        return {
            /*  Authorization: `Bearer ${this._config.apiKey}`, */
            'Content-Type': 'application/json'
        }
    }

    async init(): Promise<void> {}

    async dispose(): Promise<void> {}
}
