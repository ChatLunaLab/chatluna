import {
    AIMessageChunk,
    FunctionCall,
    MessageContent
} from '@langchain/core/messages'
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
import { getMessageContent } from 'koishi-plugin-chatluna/utils/string'

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
        const modelConfig = this._prepareModelConfig(params)
        const geminiMessages = await langchainMessageToGeminiMessage(
            params.input,
            modelConfig.model
        )

        const [systemInstruction, modelMessages] =
            extractSystemMessages(geminiMessages)

        try {
            const response = await this._post(
                `models/${modelConfig.model}:streamGenerateContent?alt=sse`,
                {
                    contents: modelMessages,
                    safetySettings: this._createSafetySettings(params.model),
                    generationConfig: this._createGenerationConfig(
                        params,
                        modelConfig
                    ),
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

            yield* this._processResponseStream(response, params)
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

    async getModels(): Promise<GeminiModelInfo[]> {
        try {
            const response = await this._get('models')
            const data = await this._parseModelsResponse(response)
            return this._filterAndTransformModels(data.models)
        } catch (e) {
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

    private _prepareModelConfig(params: ModelRequestParams) {
        let model = params.model
        let enabledThinking: boolean | undefined = null

        if (model.includes('-thinking') && model.includes('gemini-2.5')) {
            enabledThinking = !model.includes('-non-thinking')
            model = model.replace('-nom-thinking', '').replace('-thinking', '')
        }

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

        return { model, enabledThinking, thinkingBudget, imageGeneration }
    }

    private _createSafetySettings(model: string) {
        const isGemini2 = model.includes('gemini-2')

        return [
            {
                category: 'HARM_CATEGORY_HARASSMENT',
                threshold: isGemini2 ? 'OFF' : 'BLOCK_NONE'
            },
            {
                category: 'HARM_CATEGORY_HATE_SPEECH',
                threshold: isGemini2 ? 'OFF' : 'BLOCK_NONE'
            },
            {
                category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT',
                threshold: isGemini2 ? 'OFF' : 'BLOCK_NONE'
            },
            {
                category: 'HARM_CATEGORY_DANGEROUS_CONTENT',
                threshold: isGemini2 ? 'OFF' : 'BLOCK_NONE'
            },
            {
                category: 'HARM_CATEGORY_CIVIC_INTEGRITY',
                threshold: isGemini2 ? 'OFF' : 'BLOCK_NONE'
            }
        ]
    }

    private _createGenerationConfig(
        params: ModelRequestParams,
        modelConfig: ReturnType<typeof this._prepareModelConfig>
    ) {
        return {
            stopSequences: params.stop,
            temperature: params.temperature,
            maxOutputTokens: params.model.includes('vision')
                ? undefined
                : params.maxTokens,
            topP: params.topP,
            responseModalities: modelConfig.imageGeneration
                ? ['TEXT', 'IMAGE']
                : undefined,
            thinkingConfig:
                modelConfig.enabledThinking != null ||
                this._pluginConfig.includeThoughts
                    ? {
                          thinkingBudget: modelConfig.thinkingBudget,
                          includeThoughts: this._pluginConfig.includeThoughts
                      }
                    : undefined
        }
    }

    private async *_processResponseStream(
        response: fetchType.Response,
        params: ModelRequestParams
    ) {
        const { groundingContent, currentGroundingIndex } =
            this._createStreamContext()

        await checkResponse(response)

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

        yield* this._handleFinalContent(
            reasoningContent,
            groundingContent.value
        )
    }

    private _createStreamContext() {
        return {
            groundingContent: { value: '' },
            currentGroundingIndex: { value: 0 }
        }
    }

    private _setupStreamTransform(
        response: fetchType.Response,
        groundingContent: { value: string },
        currentGroundingIndex: { value: number }
    ) {
        const readableStream = new ReadableStream<string>({
            async start(controller) {
                for await (const chunk of sseIterable(response)) {
                    controller.enqueue(chunk.data)
                }
                controller.close()
            }
        })

        const transformToChatPartStream = this._createTransformStream(
            groundingContent,
            currentGroundingIndex
        )

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
        return new TransformStream<string, ChatPart>({
            async transform(chunk, controller) {
                if (chunk === 'undefined') {
                    return
                }
                const transformValue = JSON.parse(
                    chunk
                ) as unknown as ChatResponse

                if (!transformValue?.candidates) {
                    return
                }

                for (const candidate of transformValue.candidates) {
                    that._processCandidateChunk(
                        candidate,
                        controller,
                        chunk,
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

        const functionCall: ChatCompletionMessageFunctionCall & {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            arguments: any
        } = {
            name: '',
            args: '',
            arguments: ''
        }

        for await (const chunk of iterable) {
            try {
                const { updatedContent, updatedReasoning } = this._processChunk(
                    chunk,
                    reasoningContent,
                    functionCall
                )

                if (updatedReasoning !== reasoningContent) {
                    reasoningContent = updatedReasoning
                    yield { type: 'reasoning', content: reasoningContent }
                    continue
                }

                if (updatedContent || functionCall.name) {
                    const messageChunk = this._createMessageChunk(
                        updatedContent,
                        functionCall,
                        partAsTypeCheck<ChatInlineDataPart>(
                            chunk,
                            (part) => part['inlineData'] != null
                        )
                    )

                    const generationChunk = new ChatGenerationChunk({
                        message: messageChunk,
                        text: getMessageContent(messageChunk.content)
                    })

                    yield { type: 'generation', generation: generationChunk }
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

    private _processChunk(
        chunk: ChatPart,
        reasoningContent: string,
        functionCall: ChatCompletionMessageFunctionCall & {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            arguments: any
        }
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
            // TODO: As object include image_url
            messagePart.text = `![image](data:${imagePart.inlineData.mimeType ?? 'image/png'};base64,${imagePart.inlineData.data})`
            messageContent = messagePart.text
        }

        const deltaFunctionCall = chatFunctionCallingPart?.functionCall
        if (deltaFunctionCall) {
            this._updateFunctionCall(functionCall, deltaFunctionCall)
        }

        return {
            updatedContent: messageContent,
            updatedReasoning: reasoningContent
        }
    }

    private _updateFunctionCall(
        functionCall: ChatCompletionMessageFunctionCall & {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            arguments: any
        },
        deltaFunctionCall: ChatFunctionCallingPart['functionCall']
    ) {
        let args = deltaFunctionCall.args

        try {
            let parsedArgs = JSON.parse(args)
            if (typeof parsedArgs !== 'string') {
                args = parsedArgs
            }
            parsedArgs = JSON.parse(args)
            if (typeof parsedArgs !== 'string') {
                args = parsedArgs
            }
        } catch (e) {}

        functionCall.args = JSON.stringify(args)
        functionCall.name = deltaFunctionCall.name
        functionCall.arguments = deltaFunctionCall.args
    }

    private *_handleFinalContent(
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

                yield generationChunk
            }
        }
    }

    private _createMessageChunk(
        content: MessageContent,
        functionCall: FunctionCall & ChatCompletionMessageFunctionCall,
        imagePart: ChatInlineDataPart
    ) {
        const messageChunk = new AIMessageChunk({
            content
        })

        messageChunk.additional_kwargs = {
            function_call:
                functionCall.name.length > 0
                    ? ({
                          name: functionCall.name,
                          arguments: functionCall.args,
                          args: functionCall.arguments
                          // eslint-disable-next-line @typescript-eslint/no-explicit-any
                      } as any)
                    : undefined,
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
