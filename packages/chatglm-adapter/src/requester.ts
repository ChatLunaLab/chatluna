import { EmbeddingsRequester, EmbeddingsRequestParams, ModelRequester, ModelRequestParams } from '@dingyi222666/koishi-plugin-chathub/lib/llm-core/platform/api'
import { ClientConfig } from '@dingyi222666/koishi-plugin-chathub/lib/llm-core/platform/config'
import { request } from '@dingyi222666/koishi-plugin-chathub/lib/utils/request'
import * as fetchType from 'undici/types/fetch'
import { ChatGenerationChunk } from 'langchain/schema'
import { ChatCompletionResponse, ChatCompletionResponseMessageRoleEnum, CreateEmbeddingResponse } from './types'
import { ChatHubError, ChatHubErrorCode } from '@dingyi222666/koishi-plugin-chathub/lib/utils/error'
import { sseIterable } from '@dingyi222666/koishi-plugin-chathub/lib/utils/sse'
import { convertDeltaToMessageChunk, formatToolsToOpenAIFunctions, langchainMessageToOpenAIMessage } from './utils'
import { createLogger } from '@dingyi222666/koishi-plugin-chathub/lib/utils/logger'

const logger = createLogger()

export class OpenLLMRequester extends ModelRequester implements EmbeddingsRequester {
    constructor(private _config: ClientConfig) {
        super()
    }

    async* completionStream(params: ModelRequestParams): AsyncGenerator<ChatGenerationChunk> {
        try {
            const response = await this._post(
                'chat/completions',
                {
                    model: params.model,
                    messages: langchainMessageToOpenAIMessage(params.input),
                    functions: params.tools != null ? formatToolsToOpenAIFunctions(params.tools) : undefined,
                    stop: params.stop,
                    max_tokens: params.maxTokens,
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

            let defaultRole: ChatCompletionResponseMessageRoleEnum = 'assistant'

            for await (const chunk of iterator) {
                if (chunk === '[DONE]') {
                    return
                }

                try {
                    const data = JSON.parse(chunk) as ChatCompletionResponse

                    if ((data as any).error) {
                        throw new ChatHubError(ChatHubErrorCode.API_REQUEST_FAILED, new Error('error when calling completion, Result: ' + chunk))
                    }

                    const choice = data.choices?.[0]
                    if (!choice) {
                        continue
                    }

                    const { delta } = choice
                    const messageChunk = convertDeltaToMessageChunk(delta, defaultRole)

                    messageChunk.content = content + messageChunk.content

                    defaultRole = (delta.role ?? defaultRole) as ChatCompletionResponseMessageRoleEnum

                    const generationChunk = new ChatGenerationChunk({
                        message: messageChunk,
                        text: messageChunk.content
                    })
                    yield generationChunk
                    content = messageChunk.content
                } catch (e) {
                    continue
                    /* throw new ChatHubError(ChatHubErrorCode.API_REQUEST_FAILED, new Error("error when calling completion, Result: " + chunk)) */
                }
            }
        } catch (e) {
            if (e instanceof ChatHubError) {
                throw e
            } else {
                throw new ChatHubError(ChatHubErrorCode.API_REQUEST_FAILED, e)
            }
        }
    }

    async embeddings(params: EmbeddingsRequestParams): Promise<number[] | number[][]> {
        let data: CreateEmbeddingResponse | any

        try {
            const response = await this._post('embeddings', {
                inout: params.input,
                model: params.model
            })

            data = await response.text()

            data = JSON.parse(data) as CreateEmbeddingResponse

            if (data.data && data.data.length > 0) {
                return (data as CreateEmbeddingResponse).data.map((it) => it.embedding)
            }

            throw new Error()
        } catch (e) {
            const error = new Error('error when calling embeddings, Result: ' + JSON.stringify(data))

            error.stack = e.stack
            error.cause = e.cause

            throw new ChatHubError(ChatHubErrorCode.API_REQUEST_FAILED, error)
        }
    }

    async getModels(): Promise<string[]> {
        let data: any
        try {
            const response = await this._get('models')
            data = await response.text()
            data = JSON.parse(data as string)

            return (<Record<string, any>[]>data.data).map((model) => model.id)
        } catch (e) {
            const error = new Error('error when listing models, Result: ' + JSON.stringify(data))

            error.stack = e.stack
            error.cause = e.cause

            throw error
        }
    }

    private _post(url: string, data: any, params: fetchType.RequestInit = {}) {
        const requestUrl = this._concatUrl(url)

        const body = JSON.stringify(data)

        return request.fetch(requestUrl, {
            body,
            headers: this._buildHeaders(),
            method: 'POST',
            ...params
        })
    }

    private _get(url: string) {
        const requestUrl = this._concatUrl(url)

        return request.fetch(requestUrl, {
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
