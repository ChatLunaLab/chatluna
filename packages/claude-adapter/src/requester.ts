import { AIMessageChunk } from '@langchain/core/messages'
import * as fetchType from 'undici/types/fetch'
import {
    ModelRequester,
    ModelRequestParams
} from 'koishi-plugin-chatluna/src/llm-core/platform/api'
import { ChatGenerationChunk } from '@langchain/core/outputs'
import { ClientConfig } from 'koishi-plugin-chatluna/src/llm-core/platform/config'
import {
    ChatLunaError,
    ChatLunaErrorCode
} from 'koishi-plugin-chatluna/src/utils/error'
import { Context } from 'koishi'
import { chatLunaFetch } from 'koishi-plugin-chatluna/src/utils/request'
import { sseIterable } from 'koishi-plugin-chatluna/src/utils/sse'
import { Config } from '.'
import { ClaudeDeltaResponse, ClaudeRequest } from './types'
import { langchainMessageToClaudeMessage } from './utils'

export class ClaudeRequester extends ModelRequester {
    constructor(
        private ctx: Context,
        private _pluginConfig: Config,
        private _config: ClientConfig
    ) {
        super()
    }

    async *completionStream(
        params: ModelRequestParams
    ): AsyncGenerator<ChatGenerationChunk> {
        const response = await this._post('messages', {
            model: params.model,
            max_tokens: params.maxTokens,
            temperature: params.temperature,
            top_p: params.topP,
            stop_sequences:
                typeof params.stop === 'string' ? [params.stop] : params.stop,
            stream: true,
            messages: langchainMessageToClaudeMessage(
                params.input,
                params.model
            )
        } satisfies ClaudeRequest)

        const iterator = sseIterable(response)

        let content = ''

        for await (const event of iterator) {
            if (event.event === 'ping') continue

            if (event.event === 'error') {
                throw new ChatLunaError(
                    ChatLunaErrorCode.API_REQUEST_FAILED,
                    new Error(event.data)
                )
            }

            if (event.event === 'message_stop') return

            const chunk = event.data

            if (chunk === '[DONE]') {
                return
            }

            const parsedChunk = JSON.parse(chunk) as ClaudeDeltaResponse

            content += parsedChunk.delta.text

            yield new ChatGenerationChunk({
                message: new AIMessageChunk(content),
                text: content
            })
        }
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

        // console.log('POST', requestUrl, body)

        return chatLunaFetch(requestUrl, {
            body,
            headers: this._buildHeaders(),
            method: 'POST',
            ...params
        })
    }

    private _buildHeaders() {
        return {
            'x-api-key': this._config.apiKey,
            'anthropic-version': '2023-06-01',
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

    dispose(): Promise<void> {
        return Promise.resolve(undefined)
    }

    init(): Promise<void> {
        return Promise.resolve(undefined)
    }
}
