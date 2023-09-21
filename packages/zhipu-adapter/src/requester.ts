import {
    ModelRequester,
    ModelRequestParams
} from '@dingyi222666/koishi-plugin-chathub/lib/llm-core/platform/api'
import { ClientConfig } from '@dingyi222666/koishi-plugin-chathub/lib/llm-core/platform/config'
import * as fetchType from 'undici/types/fetch'
import { AIMessageChunk, ChatGenerationChunk } from 'langchain/schema'
import { ChatCompletionRequest } from './types'
import { ChatHubError, ChatHubErrorCode } from '@dingyi222666/koishi-plugin-chathub/lib/utils/error'
import { sseIterable } from '@dingyi222666/koishi-plugin-chathub/lib/utils/sse'
import { langchainMessageToZhipuMessage } from './utils'
import { createLogger } from '@dingyi222666/koishi-plugin-chathub/lib/utils/logger'
import { chathubFetch } from '@dingyi222666/koishi-plugin-chathub/lib/utils/request'
import * as jwt from 'jsonwebtoken'
const logger = createLogger()

export class ZhipuRequester extends ModelRequester {
    constructor(private _config: ClientConfig) {
        super()
    }

    async *completionStream(params: ModelRequestParams): AsyncGenerator<ChatGenerationChunk> {
        try {
            const response = await this._post(
                {
                    model: params.model,
                    prompt: langchainMessageToZhipuMessage(params.input),
                    temperature: params.temperature,
                    top_p: params.topP,
                    incremental: true
                },
                {
                    signal: params.signal
                }
            )

            const iterator = sseIterable(response, (data, event) => {
                if (event === 'error' || event === 'interrupted') {
                    throw new Error(data)
                }
                return true
            })

            let content = ''

            for await (const chunk of iterator) {
                if (chunk === '[DONE]') {
                    return
                }

                logger.debug(chunk)

                try {
                    content += chunk

                    const generationChunk = new ChatGenerationChunk({
                        message: new AIMessageChunk(content),
                        text: content
                    })

                    yield generationChunk
                } catch (e) {
                    throw new ChatHubError(
                        ChatHubErrorCode.API_REQUEST_FAILED,
                        new Error('error when calling zhipu completion, Result: ' + chunk)
                    )
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
    private _post(data: ChatCompletionRequest, params: fetchType.RequestInit = {}) {
        const requestUrl = this._concatUrl(data)

        const body = JSON.stringify(data)

        return chathubFetch(requestUrl, {
            body,
            headers: this._buildHeaders(),
            method: 'POST',
            ...params
        })
    }

    private _buildHeaders() {
        return {
            Authorization: `Bearer ${this._generateToken(this._config.apiKey)}`,
            'Content-Type': 'application/json',
            accept: 'text/event-stream'
        }
    }

    private _generateToken(rawApiKey: string): string {
        const [apiKey, secret] = rawApiKey.split('.')

        const payload = {
            api_key: apiKey,
            exp: Date.now() + 3 * 60 * 1000,
            timestamp: Date.now()
        }

        return jwt.sign(payload, secret, {
            algorithm: 'HS256',
            header: {
                alg: 'HS256'
            }
        })
    }

    private _concatUrl(data: ChatCompletionRequest): string {
        const endPoint = `https://open.bigmodel.cn/api/paas/v3/model-api/${data.model}/sse-invoke`

        return endPoint
    }

    async init(): Promise<void> {}

    async dispose(): Promise<void> {}
}
