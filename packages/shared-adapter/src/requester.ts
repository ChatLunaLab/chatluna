import { ChatGenerationChunk } from '@langchain/core/outputs'
import {
    EmbeddingsRequestParams,
    ModelRequester,
    ModelRequestParams
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
    CreateEmbeddingResponse
} from './types'
import {
    convertDeltaToMessageChunk,
    convertMessageToMessageChunk,
    formatToolsToOpenAITools,
    langchainMessageToOpenAIMessage
} from './utils'
import { ChatLunaPlugin } from 'koishi-plugin-chatluna/services/chat'
import { Context } from 'koishi'
import { AIMessageChunk } from '@langchain/core/messages'
import { Response } from 'undici/types/fetch'
import { getMessageContent } from 'koishi-plugin-chatluna/utils/string'
import { RunnableConfig } from '@langchain/core/runnables'
import { trackLogToLocal } from 'koishi-plugin-chatluna/utils/logger'

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

export async function buildChatCompletionParams(
    params: ModelRequestParams,
    plugin: ChatLunaPlugin,
    enableGoogleSearch: boolean,
    supportImageInput?: boolean
) {
    const base = {
        model: params.model,
        messages: await langchainMessageToOpenAIMessage(
            params.input,
            plugin,
            params.model,
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
        max_tokens: params.model.includes('vision')
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
        stream: true,
        logit_bias: params.logitBias,
        stream_options: {
            include_usage: true
        }
    }

    if (
        params.model.includes('o1') ||
        params.model.includes('o3') ||
        params.model.includes('o4') ||
        params.model.includes('gpt-5')
    ) {
        delete base.temperature
        delete base.presence_penalty
        delete base.frequency_penalty
        delete base.n
        delete base.top_p
    }
    return base
}

export function processReasoningContent(
    delta: { reasoning_content?: string; content?: string },
    reasoningState: { content: string; time: number; isSet: boolean }
) {
    if (delta.reasoning_content) {
        reasoningState.content += delta.reasoning_content
        if (reasoningState.time === 0) {
            reasoningState.time = Date.now()
        }
    }

    if (
        (delta.reasoning_content == null || delta.reasoning_content === '') &&
        delta.content &&
        delta.content.length > 0 &&
        reasoningState.time > 0 &&
        !reasoningState.isSet
    ) {
        const reasoningTime = Date.now() - reasoningState.time
        reasoningState.time = reasoningTime
        reasoningState.isSet = true
        return reasoningTime
    }
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
    const reasoningState = { content: '', time: 0, isSet: false }

    for await (const event of iterator) {
        const chunk = event.data
        if (chunk === '[DONE]') break
        if (chunk === '' || chunk == null || chunk === 'undefined') continue

        try {
            const data = JSON.parse(chunk) as ChatCompletionResponse

            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            if ((data as any).error) {
                throw new ChatLunaError(
                    ChatLunaErrorCode.API_REQUEST_FAILED,
                    new Error('Error when calling completion, Result: ' + chunk)
                )
            }

            const choice = data.choices?.[0]

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

            if (!choice) continue

            const { delta } = choice
            const messageChunk = convertDeltaToMessageChunk(delta, defaultRole)

            const reasoningTime = processReasoningContent(delta, reasoningState)
            if (reasoningTime !== undefined) {
                messageChunk.additional_kwargs.reasoning_time = reasoningTime
            }

            defaultRole = (
                (delta.role?.length ?? 0) > 0 ? delta.role : defaultRole
            ) as ChatCompletionResponseMessageRoleEnum

            yield new ChatGenerationChunk({
                message: messageChunk,
                text: messageChunk.content as string
            })
        } catch (e) {
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

    if (reasoningState.content.length > 0) {
        requestContext.modelRequester.logger.debug(
            `reasoning content: ${reasoningState.content}. Use time: ${reasoningState.time / 1000}s`
        )
    }
}

export async function processResponse<
    T extends ClientConfig,
    R extends ChatLunaPlugin.Config
>(requestContext: RequestContext<T, R>, response: Response) {
    if (response.status !== 200) {
        throw new ChatLunaError(
            ChatLunaErrorCode.API_REQUEST_FAILED,
            new Error(
                'Error when calling completion, Status: ' +
                    response.status +
                    ' ' +
                    response.statusText +
                    ', Response: ' +
                    (await response.text())
            )
        )
    }

    const responseText = await response.text()

    try {
        const data = JSON.parse(responseText) as ChatCompletionResponse

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        if ((data as any).error) {
            throw new ChatLunaError(
                ChatLunaErrorCode.API_REQUEST_FAILED,
                new Error(
                    'Error when calling completion, Result: ' + responseText
                )
            )
        }

        const choice = data.choices?.[0]

        if (!choice) {
            throw new ChatLunaError(
                ChatLunaErrorCode.API_REQUEST_FAILED,
                new Error(
                    'Error when calling completion, Result: ' + responseText
                )
            )
        }

        const messageChunk = convertMessageToMessageChunk(choice.message)

        return new ChatGenerationChunk({
            message: messageChunk,
            text: getMessageContent(messageChunk.content),
            generationInfo: {
                tokenUsage: data.usage
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
        if (requestContext.ctx.chatluna.config.isLog) {
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

        return await processResponse(requestContext, response)
    } catch (e) {
        if (requestContext.ctx.chatluna.config.isLog) {
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

export async function createEmbeddings<
    T extends ClientConfig,
    R extends ChatLunaPlugin.Config
>(
    requestContext: RequestContext<T, R>,
    params: EmbeddingsRequestParams,
    embeddingUrl: string = 'embeddings'
): Promise<number[] | number[][]> {
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
            return data.data.map((item) => item.embedding)
        }

        throw new Error(`Call Embedding Error: ${JSON.stringify(data)}`)
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
        return data.data.map((model: any) => model.id)
    } catch (e) {
        if (e instanceof ChatLunaError) {
            throw e
        }

        throw new Error(
            'error when listing openai models, Result: ' + JSON.stringify(data)
        )
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
