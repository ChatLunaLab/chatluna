import { ChatGenerationChunk } from '@langchain/core/outputs'
import {
    attachInvocationMetrics,
    createModelUsageTiming,
    EmbeddingsRequestParams,
    EmbeddingsResult,
    ModelRequester,
    ModelRequestParams,
    RerankerRequestParams,
    RerankerResult,
    RerankerUsageResult
} from 'koishi-plugin-chatluna/llm-core/platform/api'
import { ClientConfig } from 'koishi-plugin-chatluna/llm-core/platform/config'
import {
    ChatLunaError,
    ChatLunaErrorCode
} from 'koishi-plugin-chatluna/utils/error'
import { SSEEvent, sseIterable } from 'koishi-plugin-chatluna/utils/sse'
import {
    ChatCompletionResponse,
    ChatCompletionResponseMessageRoleEnum,
    CreateEmbeddingResponse,
    CreateRerankResponse,
    OpenAIError,
    type ResponseBuiltinTool,
    ResponseObject,
    ResponseOutputItem,
    ResponseStreamEvent,
    UNSAFE_OPENAI_ERROR_CODES
} from './types'
import {
    convertDeltaToMessageChunk,
    convertMessageToMessageChunk,
    formatToolsToOpenAITools,
    formatToolsToResponseTools,
    langchainMessageToOpenAIMessage,
    langchainMessageToResponseInput,
    openAIResponseUsageToUsageMetadata,
    openAIUsageToUsageMetadata,
    responseOutputImageItems,
    responseOutputText,
    responseOutputToolCalls
} from './utils'
import { ChatLunaPlugin } from 'koishi-plugin-chatluna/services/chat'
import { Context } from 'koishi'
import { AIMessageChunk } from '@langchain/core/messages'
import { Response } from 'undici/types/fetch'
import { getMessageContent } from 'koishi-plugin-chatluna/utils/string'
import { RunnableConfig } from '@langchain/core/runnables'
import { trackLogToLocal } from 'koishi-plugin-chatluna/utils/logger'
import { deepAssign } from 'koishi-plugin-chatluna/utils/object'
import {
    expandReasoningEffortModelVariants,
    parseOpenAIModelNameWithReasoningEffort
} from './client'

interface RequestContext<
    T extends ClientConfig = ClientConfig,
    R extends ChatLunaPlugin.Config = ChatLunaPlugin.Config
> {
    ctx: Context
    config: T
    pluginConfig: R
    plugin: ChatLunaPlugin
    modelRequester: ModelRequester<T, R>
}

function attachUsage(
    chunk: ChatGenerationChunk,
    start: number,
    usageMetadata = chunk.message instanceof AIMessageChunk
        ? chunk.message.usage_metadata
        : undefined
) {
    attachInvocationMetrics(chunk, {
        usageMetadata,
        timing: createModelUsageTiming(start, undefined, usageMetadata)
    })
    return chunk
}

export type ResponseImageProvider = (
    item: Extract<ResponseOutputItem, { type: 'image_generation_call' }>
) => Promise<string>

export interface ResponseToolOptions {
    googleSearch?: boolean
    builtinTools?: ResponseBuiltinTool[]
}

function throwIfUnsafeCode(
    code: string | undefined | null,
    detail: string
): void {
    if (code != null && UNSAFE_OPENAI_ERROR_CODES.includes(code)) {
        throw new ChatLunaError(
            ChatLunaErrorCode.API_UNSAFE_CONTENT,
            new Error('Unsafe content detected, please try again.' + detail)
        )
    }
}

function throwIfUnsafeBody(body: string): void {
    try {
        const parsed = JSON.parse(body) as { error?: OpenAIError } | null
        if (parsed) throwIfUnsafeCode(parsed.error?.code, body)
    } catch (e) {
        if (e instanceof ChatLunaError) throw e
    }
}

export async function buildChatCompletionParams(
    params: ModelRequestParams,
    plugin: ChatLunaPlugin,
    enableGoogleSearch: boolean,
    supportImageInput?: boolean
) {
    const parsedModel = parseOpenAIModelNameWithReasoningEffort(params.model)
    const normalizedModel = parsedModel.model

    const base = {
        model: normalizedModel,
        messages: await langchainMessageToOpenAIMessage(
            params.input,
            plugin,
            normalizedModel,
            supportImageInput
        ),
        tools:
            enableGoogleSearch || params.tools != null
                ? formatToolsToOpenAITools(
                      params.tools ?? [],
                      enableGoogleSearch
                  )
                : undefined,
        stop: params.stop || undefined,
        max_tokens: normalizedModel.includes('vision')
            ? undefined
            : params.maxTokens,
        temperature: params.temperature === 0 ? undefined : params.temperature,
        presence_penalty:
            params.presencePenalty === 0 ? undefined : params.presencePenalty,
        frequency_penalty:
            params.frequencyPenalty === 0 ? undefined : params.frequencyPenalty,
        n: params.n,
        top_p: params.topP,
        prompt_cache_key: params.id,
        prompt_cache_retention: undefined,
        prediction: undefined,
        reasoning_effort: parsedModel.reasoningEffort,
        response_format: undefined,
        safety_identifier: undefined,
        service_tier: undefined,
        stream: true,
        logit_bias: params.logitBias,
        stream_options: {
            include_usage: true
        }
    }

    const lowerModel = normalizedModel.toLowerCase()
    const isOpenAIReasoningModel =
        lowerModel.startsWith('o1') ||
        lowerModel.startsWith('o3') ||
        lowerModel.startsWith('o4') ||
        lowerModel.startsWith('gpt-5')

    if (isOpenAIReasoningModel) {
        delete base.temperature
        delete base.presence_penalty
        delete base.frequency_penalty
        delete base.n
        delete base.top_p
    }
    return deepAssign({}, base, params.overrideRequestParams ?? {})
}

export async function buildResponseParams(
    params: ModelRequestParams,
    plugin: ChatLunaPlugin,
    opts: ResponseToolOptions = {},
    supportImageInput?: boolean
) {
    const parsedModel = parseOpenAIModelNameWithReasoningEffort(params.model)
    const normalizedModel = parsedModel.model

    const base = {
        model: normalizedModel,
        input: await langchainMessageToResponseInput(
            params.input,
            plugin,
            normalizedModel,
            supportImageInput
        ),
        tools:
            opts.googleSearch ||
            (opts.builtinTools?.length ?? 0) > 0 ||
            params.tools != null
                ? formatToolsToResponseTools(
                      params.tools ?? [],
                      opts.googleSearch ?? false,
                      opts.builtinTools
                  )
                : undefined,
        max_output_tokens: normalizedModel.includes('vision')
            ? undefined
            : params.maxTokens,
        temperature: params.temperature === 0 ? undefined : params.temperature,
        top_p: params.topP,
        prompt_cache_key: params.id,
        reasoning:
            parsedModel.reasoningEffort == null ||
            parsedModel.reasoningEffort === 'none'
                ? undefined
                : { effort: parsedModel.reasoningEffort },
        stream: true,
        stream_options: {
            include_obfuscation: false
        },
        store: false,
        parallel_tool_calls: true
    }

    return deepAssign({}, base, params.overrideRequestParams ?? {})
}

// eslint-disable-next-line generator-star-spacing
export async function* processStreamResponse<
    T extends ClientConfig,
    R extends ChatLunaPlugin.Config
>(
    requestContext: RequestContext<T, R>,
    iterator: AsyncGenerator<SSEEvent, string, unknown>
) {
    let defaultRole: ChatCompletionResponseMessageRoleEnum = 'assistant'
    let errorCount = 0
    const reasoningState = {
        content: '',
        seen: false,
        startedAt: Date.now(),
        endedAt: undefined as number | undefined
    }

    for await (const event of iterator) {
        const chunk = event.data
        if (chunk === '[DONE]') break
        if (chunk === '' || chunk == null || chunk === 'undefined') continue

        try {
            const data = JSON.parse(chunk) as ChatCompletionResponse

            if (data.error) {
                throwIfUnsafeCode(data.error.code, chunk)
                throw new ChatLunaError(
                    ChatLunaErrorCode.API_REQUEST_FAILED,
                    new Error('Error when calling completion, Result: ' + chunk)
                )
            }

            const choice = data.choices?.[0]

            throwIfUnsafeCode(choice?.finish_reason, chunk)

            if (data.usage) {
                const usageMetadata = openAIUsageToUsageMetadata(data.usage)
                yield new ChatGenerationChunk({
                    generationInfo: {
                        usage_metadata: usageMetadata
                    },
                    message: new AIMessageChunk({
                        content: '',
                        usage_metadata: usageMetadata
                    }),
                    text: ''
                })
            }

            if (!choice) continue

            const delta = choice.delta

            if (delta == null) {
                const messageChunk = convertMessageToMessageChunk(
                    reasoningState.content.length > 0 &&
                        (choice.message.reasoning_content?.length ?? 0) < 1
                        ? {
                              ...choice.message,
                              reasoning_content: reasoningState.content
                          }
                        : choice.message
                )

                reasoningState.content = ''

                if (reasoningState.endedAt == null) {
                    reasoningState.endedAt = Date.now()
                }

                defaultRole = (
                    (choice.message.role?.length ?? 0) > 0
                        ? choice.message.role
                        : defaultRole
                ) as ChatCompletionResponseMessageRoleEnum

                yield new ChatGenerationChunk({
                    message: messageChunk,
                    text: getMessageContent(messageChunk.content)
                })
                continue
            }

            const hasResult =
                (delta.content?.length ?? 0) > 0 ||
                (delta.tool_calls?.length ?? 0) > 0 ||
                delta.function_call != null

            if (reasoningState.endedAt == null && hasResult) {
                reasoningState.endedAt = Date.now()
            }

            // DeepSeek-V4 thinking mode may emit reasoning_content === "".
            // Track field presence so we can echo it back verbatim later.
            if (Object.hasOwn(delta, 'reasoning_content')) {
                reasoningState.seen = true
                if (
                    reasoningState.endedAt == null &&
                    !hasResult &&
                    typeof delta.reasoning_content === 'string'
                ) {
                    reasoningState.content += delta.reasoning_content
                }
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
                    (delta.role?.length ?? 0) > 0 ? delta.role : defaultRole
                ) as ChatCompletionResponseMessageRoleEnum
                continue
            }

            defaultRole = (
                (delta.role?.length ?? 0) > 0 ? delta.role : defaultRole
            ) as ChatCompletionResponseMessageRoleEnum

            yield new ChatGenerationChunk({
                message: messageChunk,
                text: getMessageContent(messageChunk.content)
            })
        } catch (e) {
            if (e instanceof ChatLunaError) throw e

            if (
                chunk.includes('tool_calls') ||
                chunk.includes('function_call') ||
                chunk.includes('tool_call_id')
            ) {
                requestContext.modelRequester.logger.error(
                    'error with chunk',
                    chunk
                )
                throw new ChatLunaError(ChatLunaErrorCode.API_REQUEST_FAILED, e)
            }

            if (errorCount > 5) {
                requestContext.modelRequester.logger.error(
                    'error with chunk',
                    chunk
                )
                throw new ChatLunaError(ChatLunaErrorCode.API_REQUEST_FAILED, e)
            }
            errorCount++
        }
    }

    if (reasoningState.seen || reasoningState.content.length > 0) {
        const reasoningTime =
            (reasoningState.endedAt ?? Date.now()) - reasoningState.startedAt

        yield new ChatGenerationChunk({
            message: new AIMessageChunk({
                content: '',
                additional_kwargs: {
                    // Always emit the field (possibly "") so DeepSeek-V4
                    // thinking mode receives reasoning_content back verbatim.
                    reasoning_content: reasoningState.content,
                    ...(reasoningTime != null
                        ? { reasoning_time: reasoningTime }
                        : {})
                }
            }),
            text: ''
        })

        requestContext.modelRequester.logger.debug(
            `Reasoning Content: ${reasoningState.content}. Thought for: ${(reasoningTime ?? 0) / 1000}s`
        )
    }
}

export async function processResponse<
    T extends ClientConfig,
    R extends ChatLunaPlugin.Config
>(requestContext: RequestContext<T, R>, response: Response) {
    if (response.status !== 200) {
        const responseText = await response.text()
        throwIfUnsafeBody(responseText)

        throw new ChatLunaError(
            ChatLunaErrorCode.API_REQUEST_FAILED,
            new Error(
                'Error when calling completion, Status: ' +
                    response.status +
                    ' ' +
                    response.statusText +
                    ', Response: ' +
                    responseText
            )
        )
    }

    const responseText = await response.text()

    try {
        const data = JSON.parse(responseText) as ChatCompletionResponse

        if (data.error) {
            throwIfUnsafeCode(data.error.code, responseText)
            throw new ChatLunaError(
                ChatLunaErrorCode.API_REQUEST_FAILED,
                new Error(
                    'Error when calling completion, Result: ' + responseText
                )
            )
        }

        const choice = data.choices?.[0]

        throwIfUnsafeCode(choice?.finish_reason, responseText)

        if (!choice) {
            throw new ChatLunaError(
                ChatLunaErrorCode.API_REQUEST_FAILED,
                new Error(
                    'Error when calling completion, Result: ' + responseText
                )
            )
        }

        const messageChunk = convertMessageToMessageChunk(choice.message)
        const usageMetadata = data.usage
            ? openAIUsageToUsageMetadata(data.usage)
            : undefined

        if (messageChunk instanceof AIMessageChunk) {
            messageChunk.usage_metadata = usageMetadata
        }

        return new ChatGenerationChunk({
            message: messageChunk,
            text: getMessageContent(messageChunk.content),
            generationInfo:
                usageMetadata == null
                    ? undefined
                    : {
                          usage_metadata: usageMetadata
                      }
        })
    } catch (e) {
        if (e instanceof ChatLunaError) {
            throw e
        } else {
            throw new ChatLunaError(
                ChatLunaErrorCode.API_REQUEST_FAILED,
                new Error(
                    'Error when calling completion, Error: ' +
                        e +
                        ', Response: ' +
                        responseText
                )
            )
        }
    }
}

export async function responseToChatGeneration(
    response: ResponseObject,
    imageProvider?: ResponseImageProvider
) {
    if (response.error) {
        throwIfUnsafeCode(response.error.code, response.error.message ?? '')
        throw new ChatLunaError(
            ChatLunaErrorCode.API_REQUEST_FAILED,
            new Error(response.error.message ?? JSON.stringify(response.error))
        )
    }

    throwIfUnsafeCode(response.incomplete_details?.reason, '')

    const text = responseOutputText(response)
    const toolCalls = responseOutputToolCalls(response)
    const images = imageProvider
        ? await Promise.all(
              responseOutputImageItems(response).map((item) =>
                  imageProvider(item)
              )
          )
        : []
    const usageMetadata = response.usage
        ? openAIResponseUsageToUsageMetadata(response.usage)
        : undefined
    const message = new AIMessageChunk({
        content:
            images.length > 0
                ? [
                      ...(text.length > 0
                          ? [{ type: 'text' as const, text }]
                          : []),
                      ...images.map((image) => ({
                          type: 'image_url' as const,
                          image_url: image
                      }))
                  ]
                : text,
        tool_call_chunks: toolCalls.map((call, index) => ({
            name: call.name,
            args: call.arguments,
            id: call.call_id,
            index
        })),
        usage_metadata: usageMetadata,
        additional_kwargs: {
            conversation: response.conversation
        }
    })

    return new ChatGenerationChunk({
        generationInfo:
            usageMetadata == null
                ? undefined
                : {
                      usage_metadata: usageMetadata
                  },
        message,
        text
    })
}

export async function processResponseApiResponse(
    response: Response,
    imageProvider?: ResponseImageProvider
) {
    if (response.status !== 200) {
        const responseText = await response.text()
        throwIfUnsafeBody(responseText)

        throw new ChatLunaError(
            ChatLunaErrorCode.API_REQUEST_FAILED,
            new Error(
                'Error when calling responses, Status: ' +
                    response.status +
                    ' ' +
                    response.statusText +
                    ', Response: ' +
                    responseText
            )
        )
    }

    const responseText = await response.text()

    try {
        return await responseToChatGeneration(
            JSON.parse(responseText) as ResponseObject,
            imageProvider
        )
    } catch (e) {
        if (e instanceof ChatLunaError) throw e
        throw new ChatLunaError(
            ChatLunaErrorCode.API_REQUEST_FAILED,
            new Error(
                'Error when calling responses, Error: ' +
                    e +
                    ', Response: ' +
                    responseText
            )
        )
    }
}

// eslint-disable-next-line generator-star-spacing
export async function* processResponseApiStream<
    T extends ClientConfig,
    R extends ChatLunaPlugin.Config
>(
    requestContext: RequestContext<T, R>,
    iterator: AsyncGenerator<SSEEvent, string, unknown>,
    imageProvider?: ResponseImageProvider
) {
    const args = new Map<number, string>()
    const calls = new Map<
        number,
        { name?: string; callId?: string; itemId?: string }
    >()
    let errorCount = 0
    let sentConversation = false

    for await (const event of iterator) {
        const chunk = event.data
        if (chunk === '[DONE]') break
        if (chunk === '' || chunk == null || chunk === 'undefined') continue

        try {
            const data = JSON.parse(chunk) as ResponseStreamEvent

            if (data.type === 'error') {
                throwIfUnsafeCode(data.code, data.message ?? chunk)
                throw new ChatLunaError(
                    ChatLunaErrorCode.API_REQUEST_FAILED,
                    new Error(chunk)
                )
            }

            if (data.type === 'response.output_text.delta' && data.delta) {
                yield new ChatGenerationChunk({
                    message: new AIMessageChunk(data.delta),
                    text: data.delta
                })
                continue
            }

            if (
                data.type === 'response.output_item.added' &&
                data.item?.type === 'function_call'
            ) {
                const item = data.item as Extract<
                    ResponseOutputItem,
                    { type: 'function_call' }
                >
                calls.set(data.output_index ?? calls.size, {
                    name: item.name,
                    callId: item.call_id,
                    itemId: item.id
                })
                continue
            }

            if (data.type === 'response.function_call_arguments.delta') {
                const index = data.output_index ?? 0
                args.set(index, (args.get(index) ?? '') + (data.delta ?? ''))
                continue
            }

            if (data.type === 'response.function_call_arguments.done') {
                const index = data.output_index ?? 0
                const call = calls.get(index)
                yield new ChatGenerationChunk({
                    message: new AIMessageChunk({
                        content: '',
                        tool_call_chunks: [
                            {
                                name: data.name ?? call?.name,
                                args: data.arguments ?? args.get(index) ?? '',
                                id: call?.callId ?? data.item_id,
                                index
                            }
                        ]
                    }),
                    text: ''
                })
                continue
            }

            if (data.type === 'response.completed' && data.response) {
                const usageMetadata = data.response.usage
                    ? openAIResponseUsageToUsageMetadata(data.response.usage)
                    : undefined
                const images = imageProvider
                    ? await Promise.all(
                          responseOutputImageItems(data.response).map((item) =>
                              imageProvider(item)
                          )
                      )
                    : []

                if (images.length > 0) {
                    yield new ChatGenerationChunk({
                        message: new AIMessageChunk({
                            content: images.map((image) => ({
                                type: 'image_url' as const,
                                image_url: image
                            }))
                        }),
                        text: ''
                    })
                }

                if (!sentConversation) {
                    sentConversation = true
                    yield new ChatGenerationChunk({
                        message: new AIMessageChunk({
                            content: '',
                            additional_kwargs: {
                                conversation: data.response.conversation
                            }
                        }),
                        text: ''
                    })
                }

                if (usageMetadata) {
                    yield new ChatGenerationChunk({
                        generationInfo: {
                            usage_metadata: usageMetadata
                        },
                        message: new AIMessageChunk({
                            content: '',
                            usage_metadata: usageMetadata
                        }),
                        text: ''
                    })
                }
                continue
            }

            if (
                data.type === 'response.failed' ||
                data.type === 'response.incomplete' ||
                data.type === 'response.error'
            ) {
                throwIfUnsafeCode(data.response?.incomplete_details?.reason, '')
                throwIfUnsafeCode(data.response?.error?.code, '')

                throw new ChatLunaError(
                    ChatLunaErrorCode.API_REQUEST_FAILED,
                    new Error(chunk)
                )
            }
        } catch (e) {
            if (e instanceof ChatLunaError) throw e
            if (errorCount > 5) {
                requestContext.modelRequester.logger.error(
                    'error with responses chunk',
                    chunk
                )
                throw new ChatLunaError(ChatLunaErrorCode.API_REQUEST_FAILED, e)
            }
            errorCount++
        }
    }
}

// eslint-disable-next-line generator-star-spacing
export async function* completionStream<
    T extends ClientConfig,
    R extends ChatLunaPlugin.Config
>(
    requestContext: RequestContext<T, R>,
    params: ModelRequestParams,
    completionUrl: string = 'chat/completions',
    enableGoogleSearch?: boolean,
    supportImageInput?: boolean
): AsyncGenerator<ChatGenerationChunk> {
    const { modelRequester } = requestContext

    const chatCompletionParams = await buildChatCompletionParams(
        params,
        requestContext.plugin,
        enableGoogleSearch ?? false,
        supportImageInput ?? true
    )

    try {
        const response = await modelRequester.post(
            completionUrl,
            chatCompletionParams,
            {
                signal: params.signal
            }
        )

        const iterator = sseIterable(response)
        yield* processStreamResponse(requestContext, iterator)
    } catch (e) {
        if (requestContext.ctx.chatluna.currentConfig.isLog) {
            await trackLogToLocal(
                'Request',
                JSON.stringify(chatCompletionParams),
                requestContext.ctx.logger('')
            )
        }
        if (e instanceof ChatLunaError) {
            throw e
        } else {
            throw new ChatLunaError(ChatLunaErrorCode.API_REQUEST_FAILED, e)
        }
    }
}

export async function completion<
    T extends ClientConfig,
    R extends ChatLunaPlugin.Config
>(
    requestContext: RequestContext<T, R>,
    params: ModelRequestParams,
    completionUrl: string = 'chat/completions',
    enableGoogleSearch?: boolean,
    supportImageInput?: boolean
): Promise<ChatGenerationChunk> {
    const { modelRequester } = requestContext
    const start = Date.now()

    const chatCompletionParams = await buildChatCompletionParams(
        params,
        requestContext.plugin,
        enableGoogleSearch ?? false,
        supportImageInput ?? true
    )

    delete chatCompletionParams.stream

    try {
        const response = await modelRequester.post(
            completionUrl,
            chatCompletionParams,
            {
                signal: params.signal
            }
        )

        return attachUsage(
            await processResponse(requestContext, response),
            start
        )
    } catch (e) {
        if (requestContext.ctx.chatluna.currentConfig.isLog) {
            await trackLogToLocal(
                'Request',
                JSON.stringify(chatCompletionParams),
                requestContext.ctx.logger('')
            )
        }
        if (e instanceof ChatLunaError) {
            throw e
        } else {
            throw new ChatLunaError(ChatLunaErrorCode.API_REQUEST_FAILED, e)
        }
    }
}

// eslint-disable-next-line generator-star-spacing
export async function* responseApiCompletionStream<
    T extends ClientConfig,
    R extends ChatLunaPlugin.Config
>(
    requestContext: RequestContext<T, R>,
    params: ModelRequestParams,
    opts: ResponseToolOptions = {},
    supportImageInput?: boolean,
    imageProvider?: ResponseImageProvider
): AsyncGenerator<ChatGenerationChunk> {
    const { modelRequester } = requestContext
    const request = await buildResponseParams(
        params,
        requestContext.plugin,
        opts,
        supportImageInput ?? true
    )

    try {
        const response = await modelRequester.post('responses', request, {
            signal: params.signal
        })

        yield* processResponseApiStream(
            requestContext,
            sseIterable(response),
            imageProvider
        )
    } catch (e) {
        if (requestContext.ctx.chatluna.currentConfig.isLog) {
            await trackLogToLocal(
                'Request',
                JSON.stringify(request),
                requestContext.ctx.logger('')
            )
        }
        if (e instanceof ChatLunaError) throw e
        throw new ChatLunaError(ChatLunaErrorCode.API_REQUEST_FAILED, e)
    }
}

export async function responseApiCompletion<
    T extends ClientConfig,
    R extends ChatLunaPlugin.Config
>(
    requestContext: RequestContext<T, R>,
    params: ModelRequestParams,
    opts: ResponseToolOptions = {},
    supportImageInput?: boolean,
    imageProvider?: ResponseImageProvider
): Promise<ChatGenerationChunk> {
    const { modelRequester } = requestContext
    const start = Date.now()
    const request = await buildResponseParams(
        params,
        requestContext.plugin,
        opts,
        supportImageInput ?? true
    )

    delete request.stream
    delete request.stream_options

    try {
        const response = await modelRequester.post('responses', request, {
            signal: params.signal
        })

        return attachUsage(
            await processResponseApiResponse(response, imageProvider),
            start
        )
    } catch (e) {
        if (requestContext.ctx.chatluna.currentConfig.isLog) {
            await trackLogToLocal(
                'Request',
                JSON.stringify(request),
                requestContext.ctx.logger('')
            )
        }
        if (e instanceof ChatLunaError) throw e
        throw new ChatLunaError(ChatLunaErrorCode.API_REQUEST_FAILED, e)
    }
}

export async function createEmbeddings<
    T extends ClientConfig,
    R extends ChatLunaPlugin.Config
>(
    requestContext: RequestContext<T, R>,
    params: EmbeddingsRequestParams,
    embeddingUrl: string = 'embeddings'
): Promise<EmbeddingsResult> {
    const { modelRequester } = requestContext
    let data: CreateEmbeddingResponse | string

    try {
        const response = await modelRequester.post(embeddingUrl, {
            input: params.input,
            model: params.model
        })

        data = await response.text()
        data = JSON.parse(data as string) as CreateEmbeddingResponse

        if (data.data && data.data.length > 0) {
            return data.usage
                ? {
                      data: data.data.map((item) => item.embedding),
                      usage: {
                          input_tokens: data.usage.prompt_tokens,
                          output_tokens: 0,
                          total_tokens: data.usage.total_tokens
                      }
                  }
                : data.data.map((item) => item.embedding)
        }

        throw new Error(`Call Embedding Error: ${JSON.stringify(data)}`)
    } catch (e) {
        if (e instanceof ChatLunaError) {
            throw e
        }

        throw new ChatLunaError(ChatLunaErrorCode.API_REQUEST_FAILED, e)
    }
}

export async function createRerank<
    T extends ClientConfig,
    R extends ChatLunaPlugin.Config
>(
    requestContext: RequestContext<T, R>,
    params: RerankerRequestParams,
    rerankUrl: string = 'rerank'
): Promise<RerankerResult[] | RerankerUsageResult> {
    const { modelRequester } = requestContext

    try {
        const response = await modelRequester.post(
            rerankUrl,
            {
                model: params.model,
                query: params.query,
                documents: params.documents,
                top_n: params.topN,
                max_chunks_per_doc: params.maxChunksPerDoc,
                return_documents: false
            },
            {
                signal: params.signal
            }
        )

        const data = (await response.json()) as CreateRerankResponse

        if (data.results == null) {
            throw new ChatLunaError(
                ChatLunaErrorCode.API_REQUEST_FAILED,
                new Error(`Call Rerank Error: ${JSON.stringify(data)}`)
            )
        }

        const results = data.results.map((item) => ({
            index: item.index,
            relevanceScore: item.relevance_score
        }))

        return data.usage
            ? {
                  results,
                  usage: {
                      input_tokens:
                          data.usage.prompt_tokens ??
                          data.usage.total_tokens ??
                          0,
                      output_tokens: 0,
                      total_tokens:
                          data.usage.total_tokens ??
                          data.usage.prompt_tokens ??
                          0
                  }
              }
            : results
    } catch (e) {
        if (e instanceof ChatLunaError) {
            throw e
        }

        throw new ChatLunaError(ChatLunaErrorCode.API_REQUEST_FAILED, e)
    }
}

export async function getModels<
    T extends ClientConfig,
    R extends ChatLunaPlugin.Config
>(
    requestContext: RequestContext<T, R>,
    config?: RunnableConfig
): Promise<string[]> {
    const { modelRequester } = requestContext
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let data: any

    try {
        const response = await modelRequester.get(
            'models',
            {},
            { signal: config?.signal }
        )

        data = await response.text()
        data = JSON.parse(data as string)

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const rawModels = data.data.map((model: any) => model.id) as string[]

        const expanded: string[] = []
        const seen = new Set<string>()

        const isOpenAIReasoningModel = (model: string) => {
            const lower = model.toLowerCase()
            return (
                lower.startsWith('gpt-5') ||
                lower.startsWith('o1') ||
                lower.startsWith('o3') ||
                lower.startsWith('o4')
            )
        }

        const hasThinkingTag = (model: string) => {
            const lower = model.toLowerCase()
            return (
                lower.includes('thinking') ||
                ['minimal', 'low', 'medium', 'high', 'xhigh'].some((level) =>
                    lower.includes(level)
                )
            )
        }

        const push = (model: string) => {
            if (seen.has(model)) return
            seen.add(model)
            expanded.push(model)
        }

        for (const model of rawModels) {
            push(model)

            if (!isOpenAIReasoningModel(model)) continue
            if (hasThinkingTag(model)) continue

            // OpenAI-style "thinking" via model suffixes. These are virtual
            // variants that map to request params (e.g. reasoning_effort).
            for (const variant of expandReasoningEffortModelVariants(model)) {
                push(variant)
            }
        }

        return expanded
    } catch (e) {
        if (e instanceof ChatLunaError) {
            throw e
        }

        const raw = data?.error?.message ?? data?.error ?? data
        if (raw == null) {
            throw new Error(e instanceof Error ? e.message : String(e))
        }

        throw new Error(typeof raw === 'string' ? raw : JSON.stringify(raw))
    }
}

export function createRequestContext<
    T extends ClientConfig,
    R extends ChatLunaPlugin.Config
>(
    ctx: Context,
    config: T,
    pluginConfig: R,
    plugin: ChatLunaPlugin,
    modelRequester: ModelRequester<T, R>
): RequestContext<T, R> {
    return { ctx, config, pluginConfig, plugin, modelRequester }
}
