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
import * as fetchType from 'undici/types/fetch'
import { Config, logger } from '.'
import {
    ChatCompletionResponse,
    ChatCompletionResponseMessageRoleEnum,
    CreateEmbeddingResponse
} from './types'
import {
    convertDeltaToMessageChunk,
    formatToolsToOpenAITools,
    langchainMessageToOpenAIMessage
} from './utils'
import { ChatLunaPlugin } from 'koishi-plugin-chatluna/services/chat'
import { Context } from 'koishi'

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

export function buildChatCompletionParams(
    params: ModelRequestParams,
    enableGoogleSearch: boolean,
    supportImageInput?: boolean
) {
    return {
        model: params.model,
        messages: langchainMessageToOpenAIMessage(
            params.input,
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
        temperature: params.temperature,
        presence_penalty:
            params.presencePenalty === 0 ? undefined : params.presencePenalty,
        frequency_penalty:
            params.frequencyPenalty === 0 ? undefined : params.frequencyPenalty,
        n: params.n,
        top_p: params.topP,
        user: params.user ?? 'user',
        stream: true,
        logit_bias: params.logitBias
    }
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

async function* processStreamResponse(
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
                    new Error(
                        'error when calling openai completion, Result: ' + chunk
                    )
                )
            }

            const choice = data.choices?.[0]
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
                logger.error('error with chunk', chunk)
                throw new ChatLunaError(ChatLunaErrorCode.API_REQUEST_FAILED, e)
            }
            errorCount++
        }
    }

    if (reasoningState.content.length > 0) {
        logger.debug(
            `reasoning content: ${reasoningState.content}. Use time: ${reasoningState.time / 1000}s`
        )
    }
}

function concatUrl(apiEndpoint: string, path: string): string {
    return apiEndpoint.endsWith('/')
        ? apiEndpoint + path
        : `${apiEndpoint}/${path}`
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function cleanRequestData(data: Record<string, any>): Record<string, any> {
    const cleaned = { ...data }
    for (const key in cleaned) {
        if (cleaned[key] == null) {
            delete cleaned[key]
        }
    }
    return cleaned
}

export async function* completionStream<
    T extends ClientConfig,
    R extends ChatLunaPlugin.Config
>(
    requestContext: RequestContext<T, R>,
    params: ModelRequestParams
): AsyncGenerator<ChatGenerationChunk> {
    const { config, pluginConfig, plugin, modelRequester } = requestContext

    try {
        const requestData = buildChatCompletionParams(params, false, false)
        const cleanedData = cleanRequestData(requestData)
        const requestUrl = concatUrl(config.apiEndpoint, 'chat/completions')

        const response = await plugin.fetch(requestUrl, {
            method: 'POST',
            headers: modelRequester.buildHeaders(config.apiKey),
            body: JSON.stringify(cleanedData),
            signal: params.signal
        })

        const iterator = sseIterable(response)
        yield* processStreamResponse(iterator)
    } catch (e) {
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
    params: EmbeddingsRequestParams
): Promise<number[] | number[][]> {
    const { config, plugin } = requestContext
    let data: CreateEmbeddingResponse | string

    try {
        const requestUrl = concatUrl(config.apiEndpoint, 'embeddings')
        const requestData = { input: params.input, model: params.model }

        const response = await plugin.fetch(requestUrl, {
            method: 'POST',
            headers: buildHeaders(config.apiKey),
            body: JSON.stringify(requestData)
        })

        data = await response.text()
        data = JSON.parse(data as string) as CreateEmbeddingResponse

        if (data.data && data.data.length > 0) {
            return data.data.map((item) => item.embedding)
        }

        throw new Error(
            'Error when calling openai embeddings, Result: ' +
                JSON.stringify(data)
        )
    } catch (e) {
        logger.debug(e)
        throw new ChatLunaError(ChatLunaErrorCode.API_REQUEST_FAILED, e)
    }
}

export async function getModels<
    T extends ClientConfig,
    R extends ChatLunaPlugin.Config
>(requestContext: RequestContext<T, R>): Promise<string[]> {
    const { config, plugin } = requestContext
    let data: any

    try {
        const requestUrl = concatUrl(config.apiEndpoint, 'models')
        let response = await plugin.fetch(requestUrl, {
            method: 'GET',
            headers: buildHeaders(config.apiKey)
        })

        data = await response.text()
        data = JSON.parse(data as string)

        if (data.data?.length < 1) {
            response = await plugin.fetch(requestUrl, {
                method: 'GET',
                headers: {
                    ...buildHeaders(config.apiKey),
                    'Content-Type': 'application/json'
                }
            })
            data = await response.text()
            data = JSON.parse(data as string)
        }

        return data.data.map((model: any) => model.id)
    } catch (e) {
        logger.error(e)
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
