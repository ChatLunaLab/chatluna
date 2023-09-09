import {
    EmbeddingsRequester,
    EmbeddingsRequestParams,
    ModelRequester,
    ModelRequestParams
} from '@dingyi222666/koishi-plugin-chathub/lib/llm-core/platform/api'
import { ClientConfig } from '@dingyi222666/koishi-plugin-chathub/lib/llm-core/platform/config'
import { chathubFetch } from '@dingyi222666/koishi-plugin-chathub/lib/utils/request'
import * as fetchType from 'undici/types/fetch'
import { ChatGenerationChunk } from 'langchain/schema'
import { ChatCompletionResponse, ChatCompletionResponseMessageRoleEnum } from './types'
import { ChatHubError, ChatHubErrorCode } from '@dingyi222666/koishi-plugin-chathub/lib/utils/error'
import { sseIterable } from '@dingyi222666/koishi-plugin-chathub/lib/utils/sse'
import { convertDeltaToMessageChunk, langchainMessageToOpenAIMessage } from './utils'
import { createLogger } from '@dingyi222666/koishi-plugin-chathub/lib/utils/logger'
import { parseRawModelName } from '@dingyi222666/koishi-plugin-chathub/lib/llm-core/utils/count_tokens'

const logger = createLogger()

export class GPTFreeRequester extends ModelRequester {
    constructor(private _config: ClientConfig) {
        super()
    }

    async *completionStream(params: ModelRequestParams): AsyncGenerator<ChatGenerationChunk> {
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

            for await (const chunk of iterator) {
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

                    if ((delta as any).error) {
                        throw new ChatHubError(
                            ChatHubErrorCode.API_REQUEST_FAILED,
                            new Error('error when calling openai completion, Result: ' + chunk)
                        )
                    }

                    const messageChunk = convertDeltaToMessageChunk(delta, defaultRole)

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
                    if (e instanceof ChatHubError) {
                        throw e
                    }
                    continue
                    /* throw new ChatHubError(ChatHubErrorCode.API_REQUEST_FAILED, new Error("error when calling openai completion, Result: " + chunk)) */
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

    async getModels(): Promise<string[]> {
        let data: any
        try {
            const response = await this._get('supports')
            data = await response.text()
            data = JSON.parse(data as string)

            return data.flatMap(
                (site: any) =>
                    site.models.map((model: string) => site.site + '/' + model) as string[]
            )
        } catch (e) {
            const error = new Error(
                'error when listing gptfree models, Result: ' + JSON.stringify(data)
            )

            error.stack = e.stack
            error.cause = e.cause

            throw error
        }
    }

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
