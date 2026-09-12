import {
    AIMessageChunk,
    BaseMessageChunk,
    MessageContent
} from '@langchain/core/messages'
import { ChatGeneration, ChatGenerationChunk } from '@langchain/core/outputs'
import {
    attachInvocationMetrics,
    createModelUsageTiming,
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
import {
    ChatLunaError,
    ChatLunaErrorCode
} from 'koishi-plugin-chatluna/utils/error'
import { checkResponse, sseIterable } from 'koishi-plugin-chatluna/utils/sse'
import { readableStreamToAsyncIterable } from 'koishi-plugin-chatluna/utils/stream'
import * as fetchType from 'undici/types/fetch'
import { Config, logger } from '.'
import {
    ChatPart,
    ChatResponse,
    ChatThoughtData,
    CreateEmbeddingResponse,
    GeminiModelInfo
} from './types'
import {
    createChatGenerationParams,
    getUsage,
    isMediaProcessingPart,
    isToolContext,
    prepareModelConfig
} from './utils'
import { ChatLunaPlugin } from 'koishi-plugin-chatluna/services/chat'
import { Context } from 'koishi'
import {
    getMessageContent,
    hashString
} from 'koishi-plugin-chatluna/utils/string'
import type {} from 'koishi-plugin-chatluna-storage-service'
import { ToolCallChunk } from '@langchain/core/messages/tool'
import { RunnableConfig } from '@langchain/core/runnables'
import { trackLogToLocal } from 'koishi-plugin-chatluna/utils/logger'
import {
    createRequestSignal,
    createUsageMetadata,
    ReasoningState
} from '@chatluna/v1-shared-adapter'

export class GeminiRequester
    extends ModelRequester<ClientConfig, Config>
    implements EmbeddingsRequester
{
    constructor(
        ctx: Context,
        _configPool: ClientConfigPool<ClientConfig>,
        public _pluginConfig: Config,
        public _plugin: ChatLunaPlugin<ClientConfig, Config>
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
                message: generation.message as BaseMessageChunk,
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
        const requestSignal = createRequestSignal(params)
        try {
            const response = await this._post(
                `models/${modelConfig.model}:streamGenerateContent?alt=sse`,
                chatGenerationParams,
                {
                    signal: requestSignal.signal
                }
            )
            requestSignal.clearTimeout()

            await checkResponse(response)

            yield* this._processResponseStream(
                response,
                params.timeout,
                requestSignal.signal
            )
        } catch (e) {
            if (this.ctx.chatluna.currentConfig.isLog) {
                await trackLogToLocal(
                    'Request',
                    JSON.stringify(chatGenerationParams),
                    logger,
                    'warn'
                )
            }
            if (requestSignal.signal?.aborted) {
                throw requestSignal.signal.reason ?? e
            }
            if (e instanceof ChatLunaError) {
                throw e
            } else {
                throw new ChatLunaError(ChatLunaErrorCode.API_REQUEST_FAILED, e)
            }
        } finally {
            requestSignal.dispose()
        }
    }

    async completionInternal(
        params: ModelRequestParams
    ): Promise<ChatGeneration> {
        const modelConfig = prepareModelConfig(params, this._pluginConfig)

        const start = Date.now()
        const chatGenerationParams = await createChatGenerationParams(
            params,
            this._plugin,
            modelConfig,
            this._pluginConfig
        )
        const requestSignal = createRequestSignal(params)

        try {
            const response = await this._post(
                `models/${modelConfig.model}:generateContent`,
                chatGenerationParams,
                {
                    signal: requestSignal.signal
                }
            )

            await checkResponse(response)

            const result = await this._processResponse(response)
            const usage = (result.message as AIMessageChunk).usage_metadata
            attachInvocationMetrics(result, {
                usageMetadata: usage,
                timing: createModelUsageTiming(start, undefined, usage)
            })
            return result
        } catch (e) {
            if (this.ctx.chatluna.currentConfig.isLog) {
                await trackLogToLocal(
                    'Request',
                    JSON.stringify(chatGenerationParams),
                    logger,
                    'warn'
                )
            }
            if (e instanceof ChatLunaError) {
                throw e
            } else {
                throw new ChatLunaError(ChatLunaErrorCode.API_REQUEST_FAILED, e)
            }
        } finally {
            requestSignal.dispose()
        }
    }

    async embeddings(
        params: EmbeddingsRequestParams
    ): Promise<EmbeddingsResult> {
        const input = this._prepareEmbeddingsInput(params.input)
        const requestSignal = createRequestSignal(params)

        try {
            const response = await this._post(
                `models/${params.model}:batchEmbedContents`,
                this._createEmbeddingsRequest(params.model, input),
                { signal: requestSignal.signal }
            )

            return await this._processEmbeddingsResponse(response)
        } catch (e) {
            if (e instanceof ChatLunaError) throw e
            const error = new Error(
                'error when calling gemini embeddings, Error: ' + e.message
            )
            error.stack = e.stack
            error.cause = e.cause
            logger.debug(e)
            throw new ChatLunaError(ChatLunaErrorCode.API_REQUEST_FAILED, error)
        } finally {
            requestSignal.dispose()
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

        const reasoningState = new ReasoningState()
        for await (const chunk of this._processChunks(iterable)) {
            if (chunk.type === 'reasoning') {
                reasoningState.set(chunk.content)
            } else {
                if (
                    reasoningState.endedAt == null &&
                    reasoningState.content.length > 0
                ) {
                    reasoningState.end()
                }

                result =
                    result != null
                        ? result.concat(chunk.generation)
                        : chunk.generation
            }
        }

        if (result == null) {
            throw new ChatLunaError(
                ChatLunaErrorCode.API_REQUEST_FAILED,
                new Error('empty gemini response')
            )
        }

        const finalChunk = this._handleFinalContent(
            reasoningState,
            groundingContent.value
        )

        if (finalChunk != null) {
            result = result.concat(finalChunk)
        }

        return result
    }

    private async *_processResponseStream(
        response: fetchType.Response,
        timeout?: number,
        signal?: AbortSignal
    ) {
        const { groundingContent, currentGroundingIndex } =
            this._createStreamContext()

        const iterable = this._setupStreamTransform(
            response,
            groundingContent,
            currentGroundingIndex,
            timeout,
            signal
        )

        const reasoningState = new ReasoningState()
        for await (const chunk of this._processChunks(iterable)) {
            if (chunk.type === 'reasoning') {
                reasoningState.set(chunk.content)
            } else {
                if (
                    reasoningState.endedAt == null &&
                    reasoningState.content.length > 0
                ) {
                    reasoningState.end()
                }

                yield chunk.generation
            }
        }

        const finalContent = this._handleFinalContent(
            reasoningState,
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
        currentGroundingIndex: { value: number },
        timeout?: number,
        signal?: AbortSignal
    ) {
        const transformToChatPartStream = this._createTransformStream(
            groundingContent,
            currentGroundingIndex
        )

        const readableStream = new ReadableStream<string | ChatResponse>({
            async start(controller) {
                if ('candidates' in response) {
                    controller.enqueue(response)
                    controller.close()
                    return
                }

                for await (const chunk of sseIterable(response, {
                    timeout,
                    signal
                })) {
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

                const usage = getUsage(transformValue)
                if (!transformValue?.candidates) {
                    if (usage != null) controller.enqueue({ usage })
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

                if (usage != null) controller.enqueue({ usage })
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

        if (candidate.finishReason === 'SAFETY') {
            throw new ChatLunaError(
                ChatLunaErrorCode.API_UNSAFE_CONTENT,
                new Error('Unsafe content detected, please try again.' + chunk)
            )
        }

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
        let reasoning = ''
        let errors = 0
        let index = 0

        for await (const chunk of iterable) {
            if (isMediaProcessingPart(chunk)) continue

            if ('usage' in chunk) {
                yield {
                    type: 'generation',
                    generation: new ChatGenerationChunk({
                        message: new AIMessageChunk({
                            content: '',
                            usage_metadata: createUsageMetadata({
                                inputTokens: chunk.usage.promptTokens,
                                outputTokens: chunk.usage.completionTokens,
                                totalTokens: chunk.usage.totalTokens,
                                inputImageTokens: chunk.usage.inputImageTokens,
                                outputImageTokens:
                                    chunk.usage.outputImageTokens,
                                inputAudioTokens: chunk.usage.inputAudioTokens,
                                outputAudioTokens:
                                    chunk.usage.outputAudioTokens,
                                cacheReadTokens: chunk.usage.cacheReadTokens,
                                reasoningTokens: chunk.usage.reasoningTokens
                            })
                        }),
                        text: ''
                    })
                }
                continue
            }

            try {
                let content: MessageContent
                if ('text' in chunk && chunk.text) {
                    if (chunk.thought) {
                        reasoning += chunk.text
                        yield { type: 'reasoning', content: reasoning }
                        continue
                    }
                    content = chunk.text
                } else if ('inlineData' in chunk && !chunk.thought) {
                    const image = chunk.inlineData
                    const storage = this.ctx.chatluna_storage
                    if (storage == null) {
                        content = `![image](data:${image.mimeType ?? 'image/png'};base64,${image.data})`
                    } else {
                        const hash = await hashString(image.data, 8)
                        const type = (image.mimeType ?? 'image/png').split(
                            '/'
                        )[1]
                        const file = await storage.createTempFile(
                            Buffer.from(image.data, 'base64'),
                            `${hash}.${type}`
                        )
                        content = [{ type: 'image_url', image_url: file.url }]
                    }
                }

                const fn =
                    'functionCall' in chunk ? chunk.functionCall : undefined
                let call: ToolCallChunk
                if (fn) {
                    const fresh = fn.name?.length > 0
                    call = {
                        name: fresh ? fn.name : undefined,
                        args:
                            Object.keys(fn.args ?? {}).length > 0
                                ? JSON.stringify(fn.args)
                                : undefined,
                        id: fresh
                            ? (fn.id ?? `function_call_${index}`)
                            : undefined,
                        index: fresh ? index : index - 1
                    }
                }

                const sig = chunk.thoughtSignature
                let thought: ChatThoughtData | undefined
                if (isToolContext(chunk)) {
                    thought = { parts: [chunk] }
                } else if (sig != null) {
                    const id = call?.id ?? fn?.id
                    thought =
                        id != null
                            ? { [id]: { thoughtSignature: sig } }
                            : { parts: [{ thoughtSignature: sig }] }
                }

                if (content || call || thought) {
                    const msg = new AIMessageChunk({
                        content: content ?? '',
                        tool_call_chunks: call ? [call] : [],
                        additional_kwargs: { thought_data: thought }
                    })
                    yield {
                        type: 'generation',
                        generation: new ChatGenerationChunk({
                            message: msg,
                            text: getMessageContent(msg.content) ?? ''
                        })
                    }
                }

                if (call && fn.name?.length > 0) {
                    index++
                }
            } catch (err) {
                if (errors > 5) {
                    logger.error('error with chunk', chunk)
                    throw new ChatLunaError(
                        ChatLunaErrorCode.API_REQUEST_FAILED,
                        err
                    )
                }
                errors++
            }
        }
    }

    private _handleFinalContent(
        reasoningState: ReasoningState,
        groundingContent: string
    ) {
        if (reasoningState.content.length > 0) {
            logger.debug(reasoningState.format, ...reasoningState.params)
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

    private _post(
        url: string,
        data: Record<string, unknown>,
        params: fetchType.RequestInit = {}
    ) {
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
