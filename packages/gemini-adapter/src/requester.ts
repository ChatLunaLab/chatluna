import { AIMessageChunk } from '@langchain/core/messages'
import { ChatGenerationChunk } from '@langchain/core/outputs'
import {
    EmbeddingsRequester,
    EmbeddingsRequestParams,
    ModelRequester,
    ModelRequestParams
} from 'koishi-plugin-chatluna/llm-core/platform/api'
import { ClientConfig } from 'koishi-plugin-chatluna/llm-core/platform/config'
import {
    ChatLunaError,
    ChatLunaErrorCode
} from 'koishi-plugin-chatluna/utils/error'
import { checkResponse, sseIterable } from 'koishi-plugin-chatluna/utils/sse'
import { readableStreamToAsyncIterable } from 'koishi-plugin-chatluna/utils/stream'
import * as fetchType from 'undici/types/fetch'
import { Config, logger } from '.'
import {
    ChatCompletionMessageFunctionCall,
    ChatFunctionCallingPart,
    ChatInlineDataPart,
    ChatMessagePart,
    ChatPart,
    ChatResponse,
    CreateEmbeddingResponse
} from './types'
import {
    formatToolsToGeminiAITools,
    langchainMessageToGeminiMessage,
    partAsType,
    partAsTypeCheck
} from './utils'
import { ChatLunaPlugin } from 'koishi-plugin-chatluna/services/chat'
import fs from 'fs/promises'

export class GeminiRequester
    extends ModelRequester
    implements EmbeddingsRequester
{
    constructor(
        private _config: ClientConfig,
        private _plugin: ChatLunaPlugin,
        private _pluginConfig: Config
    ) {
        super()
    }

    async *completionStream(
        params: ModelRequestParams
    ): AsyncGenerator<ChatGenerationChunk> {
        try {
            let model = params.model

            let enabledThinking: boolean | undefined = null

            if (model.includes('-thinking') && model.includes('gemini-2.5')) {
                enabledThinking = !model.includes('-no-thinking')
                model = model
                    .replace('-no-thinking', '')
                    .replace('-thinking', '')
            }

            const response = await this._post(
                `models/${model}:streamGenerateContent?alt=sse`,
                {
                    contents: await langchainMessageToGeminiMessage(
                        params.input,
                        model
                    ),
                    safetySettings: [
                        {
                            category: 'HARM_CATEGORY_HARASSMENT',
                            threshold: params.model.includes('gemini-2')
                                ? 'OFF'
                                : 'BLOCK_NONE'
                        },
                        {
                            category: 'HARM_CATEGORY_HATE_SPEECH',
                            threshold: params.model.includes('gemini-2')
                                ? 'OFF'
                                : 'BLOCK_NONE'
                        },
                        {
                            category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT',
                            threshold: params.model.includes('gemini-2')
                                ? 'OFF'
                                : 'BLOCK_NONE'
                        },
                        {
                            category: 'HARM_CATEGORY_DANGEROUS_CONTENT',
                            threshold: params.model.includes('gemini-2')
                                ? 'OFF'
                                : 'BLOCK_NONE'
                        },
                        {
                            category: 'HARM_CATEGORY_CIVIC_INTEGRITY',
                            threshold: params.model.includes('gemini-2.0')
                                ? 'OFF'
                                : 'BLOCK_NONE'
                        }
                    ],
                    generationConfig: {
                        stopSequences: params.stop,
                        temperature: params.temperature,
                        maxOutputTokens: params.model.includes('vision')
                            ? undefined
                            : params.maxTokens,
                        topP: params.topP,
                        responseModalities:
                            params.model.includes(
                                // TODO: Wait for google release to all models
                                'gemini-2.0-flash-exp'
                            ) && this._pluginConfig.imageGeneration
                                ? ['TEXT', 'IMAGE']
                                : undefined,
                        thinkingConfig:
                            enabledThinking != null
                                ? {
                                      thinkingBudget: enabledThinking
                                          ? (this._pluginConfig
                                                .thinkingBudget ?? 4096)
                                          : 0
                                      // includeThoughts: true
                                  }
                                : undefined
                    },

                    tools:
                        params.tools != null || this._pluginConfig.googleSearch
                            ? formatToolsToGeminiAITools(
                                  params.tools ?? [],
                                  this._pluginConfig,
                                  params.model
                              )
                            : undefined
                },
                {
                    signal: params.signal
                }
            )

            let errorCount = 0

            let groundingContent = ''
            let currentGroudingIndex = 0

            await checkResponse(response)

            const readableStream = new ReadableStream<string>({
                async start(controller) {
                    for await (const chunk of sseIterable(response)) {
                        controller.enqueue(chunk.data)
                    }
                    controller.close()
                }
            })

            const transformToChatPartStream = new TransformStream<
                string,
                ChatPart
            >({
                async transform(chunk, controller) {
                    const parsedValue = JSON.parse(chunk)
                    const transformValue =
                        parsedValue as unknown as ChatResponse

                    if (!transformValue.candidates) {
                        return
                    }
                    for (const candidate of transformValue.candidates) {
                        const parts = candidate.content?.parts

                        if (
                            (parts == null || parts.length < 1) &&
                            candidate.finishReason !== 'STOP'
                        ) {
                            throw new Error(chunk)
                        } else if (
                            candidate.finishReason === 'STOP' &&
                            parts == null
                        ) {
                            continue
                        }

                        for (const part of parts) {
                            controller.enqueue(part)
                        }

                        for (const source of candidate.groundingMetadata
                            ?.groundingChunks ?? []) {
                            groundingContent += `[^${currentGroudingIndex++}]: [${source.web.title}](${source.web.uri})\n`
                        }
                    }
                }
            })

            const iterable = readableStreamToAsyncIterable<ChatPart>(
                readableStream.pipeThrough(transformToChatPartStream)
            )

            let reasoningContent = ''
            let content = ''

            const functionCall: ChatCompletionMessageFunctionCall & {
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                arguments: any
            } = {
                name: '',
                args: '',
                arguments: ''
            }

            for await (const chunk of iterable) {
                const messagePart = partAsType<ChatMessagePart>(chunk)
                const chatFunctionCallingPart =
                    partAsType<ChatFunctionCallingPart>(chunk)

                const imagePart = partAsTypeCheck<ChatInlineDataPart>(
                    chunk,
                    (part) => part['inlineData'] != null
                )

                if (messagePart.text) {
                    if (messagePart.thought) {
                        reasoningContent += messagePart.text
                        continue
                    }

                    content = messagePart.text
                } else if (imagePart) {
                    messagePart.text = `![image](data:${imagePart.inlineData.mimeType ?? 'image/png'};base64,${imagePart.inlineData.data})`
                    content = messagePart.text
                }

                const deltaFunctionCall = chatFunctionCallingPart?.functionCall

                if (deltaFunctionCall) {
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    let args: any =
                        deltaFunctionCall.args?.input ?? deltaFunctionCall.args

                    try {
                        let parsedArgs = JSON.parse(args)

                        if (typeof parsedArgs !== 'string') {
                            args = parsedArgs
                        }

                        parsedArgs = JSON.parse(args)

                        if (typeof parsedArgs !== 'string') {
                            args = parsedArgs
                        }
                        // eslint-disable-next-line @typescript-eslint/no-unused-vars
                    } catch (e) {}

                    functionCall.args = JSON.stringify(args)

                    functionCall.name = deltaFunctionCall.name

                    functionCall.arguments = deltaFunctionCall.args
                }

                try {
                    const messageChunk = new AIMessageChunk(content)

                    messageChunk.additional_kwargs = {
                        function_call:
                            functionCall.name.length > 0
                                ? {
                                      name: functionCall.name,
                                      arguments: functionCall.args,
                                      args: functionCall.arguments
                                  }
                                : undefined,
                        images: imagePart
                            ? [
                                  `data:${imagePart.inlineData.mimeType ?? 'image/png'};base64,${imagePart.inlineData.data}`
                              ]
                            : undefined
                        // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    } as any

                    messageChunk.content = content

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

            if (reasoningContent.length > 0) {
                logger.debug(`reasoning content: ${reasoningContent}`)
            }

            if (groundingContent.length > 0) {
                logger.debug(`grounding content: ${groundingContent}`)

                if (this._pluginConfig.groundingContentDisplay) {
                    const groundingMessage = new AIMessageChunk(
                        `\n${groundingContent}`
                    )
                    const generationChunk = new ChatGenerationChunk({
                        message: groundingMessage,
                        text: '\n' + groundingContent
                    })

                    yield generationChunk
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

        if (typeof params.input === 'string') {
            params.input = [params.input]
        }

        try {
            const response = await this._post(
                `models/${params.model}:batchEmbedContents`,
                {
                    requests: params.input.map((input) => {
                        return {
                            model: `models/${params.model}`,
                            content: {
                                parts: [
                                    {
                                        text: input
                                    }
                                ]
                            }
                        }
                    })
                }
            )

            data = await response.text()

            data = JSON.parse(data) as CreateEmbeddingResponse

            if (data.embeddings && data.embeddings.length > 0) {
                return data.embeddings.map((embedding) => {
                    return embedding.values
                })
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
                        model.includes('gemini') ||
                        model.includes('gemma') ||
                        model.includes('embedding')
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

        fs.writeFile('./request.json', body)

        return this._plugin.fetch(requestUrl, {
            body,
            headers: this._buildHeaders(),
            method: 'POST',
            ...params
        })
    }

    private _get(url: string) {
        const requestUrl = this._concatUrl(url)

        return this._plugin.fetch(requestUrl, {
            method: 'GET',
            headers: this._buildHeaders()
        })
    }

    private _concatUrl(url: string) {
        const apiEndPoint = this._config.apiEndpoint

        // match the apiEndPoint ends with '/v1' or '/v1/' using regex

        let baseURL: URL
        if (apiEndPoint.endsWith('/')) {
            baseURL = new URL(apiEndPoint + url)
        } else {
            baseURL = new URL(apiEndPoint + '/' + url)
        }

        const searchParams = baseURL.searchParams

        searchParams.set('key', this._config.apiKey)

        return baseURL.toString()
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
