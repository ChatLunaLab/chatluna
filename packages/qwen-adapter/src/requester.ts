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
import { Config } from '.'

export class QWenRequester extends ModelRequester {
    constructor(
        private _config: ClientConfig,
        private _pluginConfig: Config
    ) {
        super()
    }

    async *completionStream(
        params: ModelRequestParams
    ): AsyncGenerator<ChatGenerationChunk> {
        try {
            const response = await this._post(
                'v1/services/aigc/text-generation/generation',
                {
                    model: params.model,
                    input: {
                        messages: langchainMessageToQWenMessage(params.input)
                    },
                    parameters: {
                        result_format: 'text',
                        top_p: params.topP,
                        temperature: params.temperature,
                        enable_search: this._pluginConfig.enableSearch
                    }
                },
                {
                    signal: params.signal
                }
            )

            const iterator = sseIterable(response)

            const defaultRole: ChatCompletionResponseMessageRoleEnum =
                'assistant'

            for await (const chunk of iterator) {
                if (chunk === '[DONE]') {
                    return
                }

                const data = JSON.parse(chunk) as ChatCompletionStreamResponse

                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                if ((data as any).message) {
                    throw new ChatHubError(
                        ChatHubErrorCode.API_REQUEST_FAILED,
                        new Error(
                            'error when calling qwen completion, Result: ' +
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
            Accept: 'text/event-stream',
            'Content-Type': 'application/json'
        }
    }

    private _concatUrl(url: string): string {
        return 'https://dashscope.aliyuncs.com/api/' + url
    }

    async init(): Promise<void> {}

    async dispose(): Promise<void> {}
}
