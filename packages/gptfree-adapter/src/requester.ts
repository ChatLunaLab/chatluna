import {
    ModelRequester,
    ModelRequestParams
} from 'koishi-plugin-chatluna/llm-core/platform/api'
import { ClientConfig } from 'koishi-plugin-chatluna/llm-core/platform/config'
import { chatLunaFetch } from 'koishi-plugin-chatluna/utils/request'
import * as fetchType from 'undici/types/fetch'
import { ChatGenerationChunk } from '@langchain/core/outputs'
import {
    ChatCompletionResponse,
    ChatCompletionResponseMessageRoleEnum
} from './types'
import {
    ChatLunaError,
    ChatLunaErrorCode
} from 'koishi-plugin-chatluna/utils/error'
import { sseIterable } from 'koishi-plugin-chatluna/utils/sse'
import {
    convertDeltaToMessageChunk,
    langchainMessageToOpenAIMessage
} from './utils'
import { createLogger } from 'koishi-plugin-chatluna/utils/logger'
import { parseRawModelName } from 'koishi-plugin-chatluna/llm-core/utils/count_tokens'
import { Context, Logger } from 'koishi'
import { ChatLunaPlugin } from 'koishi-plugin-chatluna/services/chat'

let logger: Logger

export class GPTFreeRequester extends ModelRequester {
    constructor(
        private ctx: Context,
        private _config: ClientConfig,
        private _plugin: ChatLunaPlugin
    ) {
        logger = createLogger(ctx, 'chatluna-gptfree-adapter')
        super()
    }

    async *completionStream(
        params: ModelRequestParams
    ): AsyncGenerator<ChatGenerationChunk> {
        const [site, modelName] = parseRawModelName(params.model)
        logger.debug(`gptfree site: ${site}, model: ${modelName}`)
        try {
            const response = await this._post(
                `v1/chat/completions?site=${site}`,
                {
                    model: modelName,
                    messages: langchainMessageToOpenAIMessage(params.input),
                    max_tokens: params.maxTokens,
                    stream: true
                },
                {
                    signal: params.signal
                }
            )

            const iterator = sseIterable(response)
            let content = ''

            let defaultRole: ChatCompletionResponseMessageRoleEnum = 'assistant'

            for await (const event of iterator) {
                const chunk = event.data
                if (chunk === 'done') {
                    return
                }

                logger.debug('gptfree chunk: ' + chunk)

                try {
                    const data = JSON.parse(chunk) as ChatCompletionResponse

                    const choice = data.choices?.[0]
                    if (!choice) {
                        continue
                    }

                    const { delta } = choice

                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    if ((delta as any).error) {
                        throw new ChatLunaError(
                            ChatLunaErrorCode.API_REQUEST_FAILED,
                            new Error(
                                'error when calling openai completion, Result: ' +
                                    chunk
                            )
                        )
                    }

                    const messageChunk = convertDeltaToMessageChunk(
                        delta,
                        defaultRole
                    )

                    messageChunk.content = content + messageChunk.content

                    defaultRole = (delta.role ??
                        defaultRole) as ChatCompletionResponseMessageRoleEnum

                    const generationChunk = new ChatGenerationChunk({
                        message: messageChunk,
                        text: messageChunk.content
                    })
                    yield generationChunk
                    content = messageChunk.content
                } catch (e) {
                    if (e instanceof ChatLunaError) {
                        throw e
                    }
                    continue
                    /* throw new ChatLunaError(ChatLunaErrorCode.API_REQUEST_FAILED, new Error("error when calling openai completion, Result: " + chunk)) */
                }
            }
        } catch (e) {
            if (e instanceof ChatLunaError) {
                throw e
            } else {
                throw new ChatLunaError(ChatLunaErrorCode.API_REQUEST_FAILED, e)
            }
        }
    }

    async getModels(): Promise<string[]> {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        let data: any
        try {
            const response = await this._get('supports')
            data = await response.text()
            data = JSON.parse(data as string)

            return data.flatMap(
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                (site: any) =>
                    site.models.map(
                        (model: string) => site.site + '/' + model
                    ) as string[]
            )
        } catch (e) {
            const error = new Error(
                'error when listing gptfree models, Result: ' +
                    JSON.stringify(data)
            )

            error.stack = e.stack
            error.cause = e.cause

            throw error
        }
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    private _post(url: string, data: any, params: fetchType.RequestInit = {}) {
        const requestUrl = this._concatUrl(url)

        const body = JSON.stringify(data)

        return chatLunaFetch(requestUrl, {
            body,
            headers: this._buildHeaders(),
            method: 'POST',
            ...params
        })
    }

    private _get(url: string) {
        const requestUrl = this._concatUrl(url)

        return chatLunaFetch(requestUrl, {
            method: 'GET',
            headers: this._buildHeaders()
        })
    }

    private _buildHeaders() {
        return {
            'Content-Type': 'application/json'
        }
    }

    private _concatUrl(url: string): string {
        const apiEndPoint = this._config.apiEndpoint

        return apiEndPoint + '/' + url
    }

    async init(): Promise<void> {}

    async dispose(): Promise<void> {}
}
