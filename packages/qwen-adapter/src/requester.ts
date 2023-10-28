import {
    ModelRequester,
    ModelRequestParams
} from '@dingyi222666/koishi-plugin-chathub/lib/llm-core/platform/api'
import { ClientConfig } from '@dingyi222666/koishi-plugin-chathub/lib/llm-core/platform/config'
import * as fetchType from 'undici/types/fetch'
import { ChatGenerationChunk } from 'langchain/schema'
import {
    ChatCompletionResponseMessageRoleEnum,
    ChatCompletionStreamResponse
} from './types'
import {
    ChatHubError,
    ChatHubErrorCode
} from '@dingyi222666/koishi-plugin-chathub/lib/utils/error'
import { sseIterable } from '@dingyi222666/koishi-plugin-chathub/lib/utils/sse'
import {
    convertDeltaToMessageChunk,
    langchainMessageToQWenMessage
} from './utils'
import { chathubFetch } from '@dingyi222666/koishi-plugin-chathub/lib/utils/request'

export class QWenRequester extends ModelRequester {
    constructor(private _config: ClientConfig) {
        super()
    }

    async *completionStream(
        params: ModelRequestParams
    ): AsyncGenerator<ChatGenerationChunk> {
        try {
            const response = await this._post(
                'chat/completions',
                {
                    model: params.model,
                    messages: langchainMessageToQWenMessage(params.input),
                    functions:
                        params.tools != null
                            ? formatToolsToOpenAIFunctions(params.tools)
                            : undefined,
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

            const defaultRole: ChatCompletionResponseMessageRoleEnum =
                'assistant'

            const errorCount = 0

            for await (const chunk of iterator) {
                if (chunk === '[DONE]') {
                    return
                }

                try {
                    const data = JSON.parse(
                        chunk
                    ) as ChatCompletionStreamResponse

                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    if ((data as any).message) {
                        throw new ChatHubError(
                            ChatHubErrorCode.API_REQUEST_FAILED,
                            new Error(
                                'error when calling openai completion, Result: ' +
                                    chunk
                            )
                        )
                    }

                    const choice = data.output
                    if (!choice) {
                        continue
                    }

                    const messageChunk = convertDeltaToMessageChunk(
                        choice,
                        defaultRole
                    )

                    const generationChunk = new ChatGenerationChunk({
                        message: messageChunk,
                        text: messageChunk.content
                    })

                    yield generationChunk
                } catch (e) {
                    if (errorCount > 20) {
                        throw new ChatHubError(
                            ChatHubErrorCode.API_REQUEST_FAILED,
                            new Error(
                                'error when calling openai completion, Result: ' +
                                    chunk
                            )
                        )
                    } else {
                        continue
                    }
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

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    private _post(url: string, data: any, params: fetchType.RequestInit = {}) {
        const requestUrl = this._concatUrl(url)

        const body = JSON.stringify(data)

        return chathubFetch(requestUrl, {
            body,
            headers: this._buildHeaders(),
            method: 'POST',
            ...params
        })
    }

    private _get(url: string) {
        const requestUrl = this._concatUrl(url)

        return chathubFetch(requestUrl, {
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
