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
    CreateEmbeddingResponse,
    GeminiModelInfo
} from './types'
import {
    extractSystemMessages,
    formatToolsToGeminiAITools,
    langchainMessageToGeminiMessage,
    partAsType,
    partAsTypeCheck
} from './utils'
import { ChatLunaPlugin } from 'koishi-plugin-chatluna/services/chat'
import { Context } from 'koishi'

export class GeminiRequester
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
        try {
            let model = params.model

            let enabledThinking: boolean | undefined = null

            if (model.includes('-thinking') && model.includes('gemini-2.5')) {
                enabledThinking = !model.includes('-non-thinking')
                model = model
                    .replace('-nom-thinking', '')
                    .replace('-thinking', '')
            }

            const geminiMessages = await langchainMessageToGeminiMessage(
                params.input,
                model
            )

            const [systemInstruction, modelMessages] =
                extractSystemMessages(geminiMessages)

            let thinkingBudget = this._pluginConfig.thinkingBudget ?? -1

            if (!enabledThinking && !model.includes('2.5-pro')) {
                thinkingBudget = 0
            } else if (thinkingBudget >= 0 && thinkingBudget < 128) {
                thinkingBudget = 128
            }

            let imageGeneration = this._pluginConfig.imageGeneration ?? false

            if (imageGeneration) {
                imageGeneration =
                    params.model.includes('gemini-2.0-flash-exp') ||
                    params.model.includes('gemini-2.5-flash-image')
            }

            const response = await this._post(
                `models/${model}:streamGenerateContent?alt=sse`,
                {
                    contents: modelMessages,
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
                        responseModalities: imageGeneration
                            ? ['TEXT', 'IMAGE']
                            : undefined,
                        thinkingConfig:
                            enabledThinking != null ||
                            this._pluginConfig.includeThoughts
                                ? {
                                      thinkingBudget,
                                      includeThoughts:
                                          this._pluginConfig.includeThoughts
                                  }
                                : undefined
                    },
                    system_instruction:
                        systemInstruction != null
                            ? systemInstruction
                            : undefined,
                    tools:
                        params.tools != null ||
                        this._pluginConfig.googleSearch ||
                        this._pluginConfig.codeExecution ||
                        this._pluginConfig.urlContext
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
            let currentGroundingIndex = 0

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
                    if (chunk === 'undefined') {
                        return
                    }
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
                            candidate.finishReason !== 'STOP' &&
                            candidate.content.role === null
                        ) {
                            throw new Error(chunk)
                        } else if (
                            candidate.finishReason === 'STOP' &&
                            parts == null
                        ) {
                            continue
                        }

                        if (parts == null) {
                            continue
                        }

                        for (const part of parts) {
                            controller.enqueue(part)
                        }

                        for (const source of candidate.groundingMetadata
                            ?.groundingChunks ?? []) {
                            groundingContent += `[^${currentGroundingIndex++}]: [${source.web.title}](${source.web.uri})\n`
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
                    let args: any = deltaFunctionCall.args

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

    async getModels(): Promise<GeminiModelInfo[]> {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        let data: any
        try {
            const response = await this._get('models')
            data = await response.text()
            data = JSON.parse(data as string) as {
                models: GeminiModelInfo[]
            }

            if (!data.models || !data.models.length) {
                throw new Error(
                    'error when listing gemini models, Result:' +
                        JSON.stringify(data)
                )
            }

            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            return (<GeminiModelInfo[]>data.models)
                .filter(
                    (model) =>
                        model.name.includes('gemini') ||
                        model.name.includes('gemma') ||
                        model.name.includes('embedding')
                )
                .map((model) => {
                    return {
                        ...model,
                        name: model.name.replace('models/', '')
                    }
                })
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

        // fs.writeFile('./request.json', body)

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
        const apiEndPoint = this._config.value.apiEndpoint

        // match the apiEndPoint ends with '/v1' or '/v1/' using regex

        let baseURL: URL
        if (apiEndPoint.endsWith('/')) {
            baseURL = new URL(apiEndPoint + url)
        } else {
            baseURL = new URL(apiEndPoint + '/' + url)
        }

        const searchParams = baseURL.searchParams

        searchParams.set('key', this._config.value.apiKey)

        return baseURL.toString()
    }

    private _buildHeaders() {
        return {
            /*  Authorization: `Bearer ${this._config.value.apiKey}`, */
            'Content-Type': 'application/json'
        }
    }

    get logger() {
        return logger
    }
}
