import {
    AIMessageChunk,
    BaseMessageChunk,
    MessageContent
} from '@langchain/core/messages'
import { ChatGeneration, ChatGenerationChunk } from '@langchain/core/outputs'
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
    ChatFunctionCallingPart,
    ChatInlineDataPart,
    ChatMessagePart,
    ChatPart,
    ChatResponse,
    ChatUsageMetadataPart,
    CreateEmbeddingResponse,
    GeminiModelInfo
} from './types'
import {
    createChatGenerationParams,
    isChatResponse,
    partAsType,
    partAsTypeCheck,
    prepareModelConfig
} from './utils'
import { ChatLunaPlugin } from 'koishi-plugin-chatluna/services/chat'
import { Context } from 'koishi'
import { getMessageContent } from 'koishi-plugin-chatluna/utils/string'
import type {} from 'koishi-plugin-chatluna-storage-service'
import { ToolCallChunk } from '@langchain/core/messages/tool'
import { RunnableConfig } from '@langchain/core/runnables'
import { trackLogToLocal } from 'koishi-plugin-chatluna/utils/logger'

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

    async completion(params: ModelRequestParams): Promise<ChatGeneration> {
        if (!this._pluginConfig.nonStreaming) {
            return super.completion(params)
        }

        return await this.completionInternal(params)
    }

    async *completionStreamInternal(
        params: ModelRequestParams
    ): AsyncGenerator<ChatGenerationChunk> {
        if (this._pluginConfig.nonStreaming) {
            const generation = await this.completion(params)

            yield new ChatGenerationChunk({
                generationInfo: generation.generationInfo,
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                message: generation.message as any as BaseMessageChunk,
                text: generation.text
            })

            return
        }

        const modelConfig = prepareModelConfig(params, this._pluginConfig)

        const chatGenerationParams = await createChatGenerationParams(
            params,
            this._plugin,
            modelConfig,
            this._pluginConfig
        )

        try {
            const response = await this._post(
                `models/${modelConfig.model}:streamGenerateContent?alt=sse`,
                chatGenerationParams,
                {
                    signal: params.signal
                }
            )

            await checkResponse(response)

            yield* this._processResponseStream(response)
        } catch (e) {
            if (this.ctx.chatluna.config.isLog) {
                await trackLogToLocal(
                    'Request',
                    JSON.stringify(chatGenerationParams),
                    logger
                )
            }
            if (e instanceof ChatLunaError) {
                throw e
            } else {
                throw new ChatLunaError(ChatLunaErrorCode.API_REQUEST_FAILED, e)
            }
        }
    }

    async completionInternal(
        params: ModelRequestParams
    ): Promise<ChatGeneration> {
        const modelConfig = prepareModelConfig(params, this._pluginConfig)

        const chatGenerationParams = await createChatGenerationParams(
            params,
            this._plugin,
            modelConfig,
            this._pluginConfig
        )

        try {
            const response = await this._post(
                `models/${modelConfig.model}:generateContent`,
                chatGenerationParams,
                {
                    signal: params.signal
                }
            )

            await checkResponse(response)

            return await this._processResponse(response)
        } catch (e) {
            if (this.ctx.chatluna.config.isLog) {
                await trackLogToLocal(
                    'Request',
                    JSON.stringify(chatGenerationParams),
                    logger
                )
            }
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
        const input = this._prepareEmbeddingsInput(params.input)

        try {
            const response = await this._post(
                `models/${params.model}:batchEmbedContents`,
                this._createEmbeddingsRequest(params.model, input)
            )

            return await this._processEmbeddingsResponse(response)
        } catch (e) {
            const error = new Error(
                'error when calling gemini embeddings, Error: ' + e.message
            )
            error.stack = e.stack
            error.cause = e.cause
            logger.debug(e)
            throw new ChatLunaError(ChatLunaErrorCode.API_REQUEST_FAILED, error)
        }
    }

    private _prepareEmbeddingsInput(input: string | string[]): string[] {
        return typeof input === 'string' ? [input] : input
    }

    private _createEmbeddingsRequest(model: string, input: string[]) {
        return {
            requests: input.map((text) => ({
                model: `models/${model}`,
                content: {
                    parts: [{ text }]
                }
            }))
        }
    }

    private async _processEmbeddingsResponse(
        response: fetchType.Response
    ): Promise<number[][]> {
        const data = JSON.parse(
            await response.text()
        ) as CreateEmbeddingResponse

        if (data.embeddings?.length > 0) {
            return data.embeddings.map((embedding) => embedding.values)
        }

        throw new Error(
            'error when calling gemini embeddings, Result: ' +
                JSON.stringify(data)
        )
    }

    async getModels(config?: RunnableConfig): Promise<GeminiModelInfo[]> {
        try {
            const response = await this._get('models', {
                signal: config?.signal
            })
            const data = await this._parseModelsResponse(response)
            return this._filterAndTransformModels(data.models)
        } catch (e) {
            if (e instanceof ChatLunaError) {
                throw e
            }

            const error = new Error(
                'error when listing gemini models, Error: ' + e.message
            )
            error.stack = e.stack
            error.cause = e.cause
            throw error
        }
    }

    private async _parseModelsResponse(response: fetchType.Response) {
        const text = await response.text()
        const data = JSON.parse(text) as { models: GeminiModelInfo[] }

        if (!data.models?.length) {
            throw new Error(
                'error when listing gemini models, Result:' +
                    JSON.stringify(data)
            )
        }

        return data
    }

    private _filterAndTransformModels(
        models: GeminiModelInfo[]
    ): GeminiModelInfo[] {
        return models
            .filter((model) =>
                ['gemini', 'gemma', 'embedding'].some((keyword) =>
                    model.name.includes(keyword)
                )
            )
            .map((model) => ({
                ...model,
                name: model.name.replace('models/', '')
            }))
    }

    private async _processResponse(response: fetchType.Response) {
        const { groundingContent, currentGroundingIndex } =
            this._createStreamContext()

        const responseText = await response.text()

        let parsedResponse: ChatResponse

        try {
            parsedResponse = JSON.parse(responseText) as ChatResponse

            if (!parsedResponse.candidates) {
                throw new ChatLunaError(
                    ChatLunaErrorCode.API_REQUEST_FAILED,
                    new Error(
                        'error when calling gemini, Result: ' + responseText
                    )
                )
            }
        } catch (e) {
            if (e instanceof ChatLunaError) {
                throw e
            } else {
                throw new ChatLunaError(
                    ChatLunaErrorCode.API_REQUEST_FAILED,
                    new Error(
                        'error when calling gemini, Result: ' + responseText
                    )
                )
            }
        }

        const iterable = this._setupStreamTransform(
            parsedResponse,
            groundingContent,
            currentGroundingIndex
        )

        let result: ChatGenerationChunk

        let reasoningContent = ''
        for await (const chunk of this._processChunks(iterable)) {
            if (chunk.type === 'reasoning') {
                reasoningContent = chunk.content
            } else {
                result =
                    result != null
                        ? result.concat(chunk.generation)
                        : chunk.generation
            }
        }

        const finalChunk = this._handleFinalContent(
            reasoningContent,
            groundingContent.value
        )

        if (finalChunk != null) {
            result = result.concat(finalChunk)
        }

        return result
    }

    private async *_processResponseStream(response: fetchType.Response) {
        const { groundingContent, currentGroundingIndex } =
            this._createStreamContext()

        const iterable = this._setupStreamTransform(
            response,
            groundingContent,
            currentGroundingIndex
        )

        let reasoningContent = ''
        for await (const chunk of this._processChunks(iterable)) {
            if (chunk.type === 'reasoning') {
                reasoningContent = chunk.content
            } else {
                yield chunk.generation
            }
        }

        const finalContent = this._handleFinalContent(
            reasoningContent,
            groundingContent.value
        )

        if (finalContent != null) {
            yield finalContent
        }
    }

    private _createStreamContext() {
        return {
            groundingContent: { value: '' },
            currentGroundingIndex: { value: 0 }
        }
    }

    private _setupStreamTransform(
        response: fetchType.Response | ChatResponse,
        groundingContent: { value: string },
        currentGroundingIndex: { value: number }
    ) {
        const transformToChatPartStream = this._createTransformStream(
            groundingContent,
            currentGroundingIndex
        )

        const readableStream = new ReadableStream<string | ChatResponse>({
            async start(controller) {
                if (isChatResponse(response)) {
                    controller.enqueue(response)
                    controller.close()
                    return
                }

                for await (const chunk of sseIterable(response)) {
                    controller.enqueue(chunk.data)
                }
                controller.close()
            }
        })

        return readableStreamToAsyncIterable<ChatPart>(
            readableStream.pipeThrough(transformToChatPartStream)
        )
    }

    private _createTransformStream(
        groundingContent: { value: string },
        currentGroundingIndex: { value: number }
    ) {
        // eslint-disable-next-line @typescript-eslint/no-this-alias
        const that = this
        return new TransformStream<string | ChatResponse, ChatPart>({
            async transform(chunk, controller) {
                if (chunk === 'undefined') {
                    return
                }
                const transformValue =
                    typeof chunk === 'string'
                        ? (JSON.parse(chunk) as unknown as ChatResponse)
                        : chunk

                if (transformValue.usageMetadata) {
                    const promptTokens =
                        transformValue.usageMetadata.promptTokenCount

                    const totalTokens =
                        transformValue.usageMetadata.totalTokenCount
                    const completionTokens =
                        transformValue.usageMetadata.candidatesTokenCount ??
                        totalTokens - promptTokens

                    controller.enqueue({
                        usage: {
                            promptTokens,
                            completionTokens,
                            totalTokens
                        }
                    })
                }

                if (!transformValue?.candidates) {
                    return
                }

                for (const candidate of transformValue.candidates) {
                    that._processCandidateChunk(
                        candidate,
                        controller,
                        JSON.stringify(transformValue),
                        groundingContent,
                        currentGroundingIndex
                    )
                }
            }
        })
    }

    private _processCandidateChunk(
        candidate: ChatResponse['candidates'][0],
        controller: TransformStreamDefaultController<ChatPart>,
        chunk: string,
        groundingContent: { value: string },
        currentGroundingIndex: { value: number }
    ) {
        const parts = candidate.content?.parts

        if (
            (parts == null || parts.length < 1) &&
            candidate.finishReason !== 'STOP' &&
            candidate.content === null
        ) {
            throw new Error(chunk)
        } else if (candidate.finishReason === 'STOP' && parts == null) {
            return
        }

        if (parts == null) {
            return
        }

        for (const part of parts) {
            controller.enqueue(part)
        }

        for (const source of candidate.groundingMetadata?.groundingChunks ??
            []) {
            groundingContent.value += `[^${currentGroundingIndex.value++}]: [${source.web.title}](${source.web.uri})\n`
        }
    }

    private async *_processChunks(iterable: AsyncIterable<ChatPart>) {
        let reasoningContent = ''

        let errorCount = 0

        let functionIndex = 0

        for await (const chunk of iterable) {
            let parsedChunk: ChatUsageMetadataPart | undefined
            if (
                (parsedChunk = partAsTypeCheck<ChatUsageMetadataPart>(
                    chunk,
                    (chunk) => chunk['usage'] != null
                ))
            ) {
                const generationChunk = new ChatGenerationChunk({
                    message: new AIMessageChunk({
                        content: '',
                        response_metadata: {
                            tokenUsage: parsedChunk.usage
                        }
                    }),
                    text: ''
                })

                yield { type: 'generation', generation: generationChunk }
            }

            try {
                const { updatedContent, updatedReasoning, updatedToolCalling } =
                    await this._processChunk(
                        chunk,
                        reasoningContent,
                        functionIndex
                    )

                if (updatedReasoning !== reasoningContent) {
                    reasoningContent = updatedReasoning
                    yield { type: 'reasoning', content: reasoningContent }
                    continue
                }

                if (updatedContent || updatedToolCalling) {
                    const messageChunk = this._createMessageChunk(
                        updatedContent,
                        updatedToolCalling,
                        this.ctx.chatluna_storage != null
                            ? undefined
                            : partAsTypeCheck<ChatInlineDataPart>(
                                  chunk,
                                  (part) => part['inlineData'] != null
                              )
                    )

                    const generationChunk = new ChatGenerationChunk({
                        message: messageChunk,
                        text: getMessageContent(messageChunk.content) ?? ''
                    })

                    yield { type: 'generation', generation: generationChunk }
                }

                if (updatedToolCalling) {
                    functionIndex++
                }
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
    }

    private async _processChunk(
        chunk: ChatPart,
        reasoningContent: string,
        functionIndex: number
    ) {
        const messagePart = partAsType<ChatMessagePart>(chunk)
        const chatFunctionCallingPart =
            partAsType<ChatFunctionCallingPart>(chunk)
        const imagePart = partAsTypeCheck<ChatInlineDataPart>(
            chunk,
            (part) => part['inlineData'] != null
        )

        let messageContent: MessageContent

        if (messagePart.text) {
            if (messagePart.thought) {
                return {
                    updatedContent: messageContent,
                    updatedReasoning: reasoningContent + messagePart.text
                }
            }
            messageContent = messagePart.text
        } else if (imagePart) {
            const storageService = this.ctx.chatluna_storage
            if (!storageService) {
                messagePart.text = `![image](data:${imagePart.inlineData.mimeType ?? 'image/png'};base64,${imagePart.inlineData.data})`
                messageContent = messagePart.text
            } else {
                const buffer = Buffer.from(imagePart.inlineData.data, 'base64')

                const file = await storageService.createTempFile(
                    buffer,
                    'image_random'
                )

                messagePart.text = '[image]'
                messageContent = [
                    {
                        type: 'image_url',
                        image_url: file.url
                    }
                ]
            }
        }

        const deltaFunctionCall = chatFunctionCallingPart?.functionCall
        let updatedToolCalling: ToolCallChunk
        if (deltaFunctionCall) {
            updatedToolCalling = this._createToolCallChunk(
                deltaFunctionCall,
                functionIndex
            )
        }

        return {
            updatedContent: messageContent,
            updatedReasoning: reasoningContent,
            updatedToolCalling
        }
    }

    private _createToolCallChunk(
        deltaFunctionCall: ChatFunctionCallingPart['functionCall'],
        functionIndex: number
    ) {
        return {
            name: deltaFunctionCall?.name,
            args: JSON.stringify(deltaFunctionCall.args),
            id: deltaFunctionCall.id ?? `function_call_${functionIndex}`
        } satisfies ToolCallChunk
    }

    private _handleFinalContent(
        reasoningContent: string,
        groundingContent: string
    ) {
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

                return generationChunk
            }
        }
    }

    private _createMessageChunk(
        content: MessageContent,
        functionCall: ToolCallChunk | undefined,
        imagePart: ChatInlineDataPart | undefined
    ) {
        const messageChunk = new AIMessageChunk({
            content: content ?? '',
            tool_call_chunks: [functionCall].filter(Boolean)
        })

        messageChunk.additional_kwargs = {
            images: imagePart
                ? [
                      `data:${imagePart.inlineData.mimeType ?? 'image/png'};base64,${imagePart.inlineData.data}`
                  ]
                : undefined
        }

        return messageChunk
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

        return this._plugin.fetch(requestUrl, {
            body,
            headers: this._buildHeaders(),
            method: 'POST',
            ...params
        })
    }

    private _get(url: string, params: fetchType.RequestInit = {}) {
        const requestUrl = this._concatUrl(url)

        return this._plugin.fetch(requestUrl, {
            method: 'GET',
            headers: this._buildHeaders(),
            ...params
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
