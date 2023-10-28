import {
    /*  EmbeddingsRequester,
    EmbeddingsRequestParams, */
    ModelRequester,
    ModelRequestParams
} from '@dingyi222666/koishi-plugin-chathub/lib/llm-core/platform/api'
import { ClientConfig } from '@dingyi222666/koishi-plugin-chathub/lib/llm-core/platform/config'
import * as fetchType from 'undici/types/fetch'
import { ChatGenerationChunk } from 'langchain/schema'
import {
    ChatCompletionResponse,
    WenxinMessage,
    WenxinMessageRole
} from './types'
import {
    ChatHubError,
    ChatHubErrorCode
} from '@dingyi222666/koishi-plugin-chathub/lib/utils/error'
import { sseIterable } from '@dingyi222666/koishi-plugin-chathub/lib/utils/sse'
import {
    convertDeltaToMessageChunk,
    langchainMessageToWenXinMessage,
    modelMappedUrl
} from './utils'

import { chathubFetch } from '@dingyi222666/koishi-plugin-chathub/lib/utils/request'

export class WenxinRequester extends ModelRequester {
    /*  implements EmbeddingsRequester */

    private _accessToken: string | undefined

    constructor(private _config: ClientConfig) {
        super()
    }

    async *completionStream(
        params: ModelRequestParams
    ): AsyncGenerator<ChatGenerationChunk> {
        await this.init()

        let messages = params.input

        // Wenxin requires the system message to be put in the params, not messages array
        const systemMessage = messages.find(
            (message) => message._getType() === 'system'
        )
        if (systemMessage) {
            // eslint-disable-next-line no-param-reassign
            messages = messages.filter((message) => message !== systemMessage)
        }
        const messagesMapped: WenxinMessage[] =
            langchainMessageToWenXinMessage(messages)

        try {
            const response = await this._post(
                modelMappedUrl[params.model](this._accessToken),
                {
                    messages: messagesMapped,
                    stream: true,
                    temperature: params.temperature,
                    top_p: params.topP,
                    penalty_score: params.presencePenalty
                },
                {
                    signal: params.signal
                }
            )

            const iterator = sseIterable(response)
            let content = ''

            const defaultRole: WenxinMessageRole = 'assistant'

            let errorCount = 0

            for await (const chunk of iterator) {
                if (chunk === '[DONE]') {
                    return
                }

                try {
                    const data = JSON.parse(chunk) as ChatCompletionResponse

                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    if ((data as any).error_code) {
                        throw new ChatHubError(
                            ChatHubErrorCode.API_REQUEST_FAILED,
                            new Error(
                                'error when calling openai completion, Result: ' +
                                    chunk
                            )
                        )
                    }

                    const message = data as ChatCompletionResponse
                    if (!message) {
                        continue
                    }

                    if (message.need_clear_history) {
                        errorCount = 114514
                        throw new ChatHubError(
                            ChatHubErrorCode.API_UNSAFE_CONTENT,
                            new Error(
                                'error when calling openai completion, Result: ' +
                                    chunk
                            )
                        )
                    }

                    const messageChunk = convertDeltaToMessageChunk(
                        message,
                        defaultRole
                    )

                    messageChunk.content = content + messageChunk.content

                    const generationChunk = new ChatGenerationChunk({
                        message: messageChunk,
                        text: messageChunk.content
                    })

                    yield generationChunk
                    content = messageChunk.content
                } catch (e) {
                    if (errorCount > 5) {
                        if (e instanceof ChatHubError) {
                            throw e
                        }
                        throw new ChatHubError(
                            ChatHubErrorCode.API_REQUEST_FAILED,
                            new Error(
                                'error when calling openai completion, Result: ' +
                                    chunk
                            )
                        )
                    } else {
                        errorCount++
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

    private async _getAccessToken(): Promise<string> {
        // eslint-disable-next-line max-len
        const url = `https://aip.baidubce.com/oauth/2.0/token?grant_type=client_credentials&client_id=${this._config.apiKey}&client_secret=${this._config.apiEndpoint}`
        const response = await fetch(url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Accept: 'application/json'
            }
        })
        if (!response.ok) {
            const text = await response.text()
            const error = new Error(
                `Baidu get access token failed with status code ${response.status}, response: ${text}`
            )
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            ;(error as any).response = response
            throw new ChatHubError(ChatHubErrorCode.API_REQUEST_FAILED, error)
        }
        const json = await response.json()
        return json.access_token
    }

    async init(): Promise<void> {
        if (this._accessToken == null) {
            this._accessToken = await this._getAccessToken()
        }
    }

    async dispose(): Promise<void> {}
}
