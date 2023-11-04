import {
    ModelRequester,
    ModelRequestParams
} from '@dingyi222666/koishi-plugin-chathub/lib/llm-core/platform/api'
import { WebSocket } from 'ws'
import { AIMessageChunk, ChatGenerationChunk } from 'langchain/schema'
import { createLogger } from '@dingyi222666/koishi-plugin-chathub/lib/utils/logger'
import { ws } from '@dingyi222666/koishi-plugin-chathub/lib/utils/request'
import crypto from 'crypto'
import {
    ChatHubError,
    ChatHubErrorCode
} from '@dingyi222666/koishi-plugin-chathub/lib/utils/error'

import { readableStreamToAsyncIterable } from '@dingyi222666/koishi-plugin-chathub/lib/utils/stream'
import { Context, Logger } from 'koishi'
import {
    ChatCompletionRequest,
    ChatCompletionResponse,
    SparkClientConfig
} from './types'
import { Config } from '.'
import { langchainMessageToSparkMessage, modelMapping } from './utils'
let logger: Logger

export class SparkRequester extends ModelRequester {
    constructor(
        private ctx: Context,
        private _config: SparkClientConfig,
        private _pluginConfig: Config
    ) {
        super()
        logger = createLogger(ctx, 'chathub-spark-adapter')
    }

    async *completionStream(
        params: ModelRequestParams
    ): AsyncGenerator<ChatGenerationChunk> {
        await this._init(params)

        // await this._refreshConversation()

        let err: Error | null
        const stream = new TransformStream()

        const iterable = readableStreamToAsyncIterable<string>(stream.readable)

        const writable = stream.writable.getWriter()

        setTimeout(async () => {
            const result = await this._buildListenerPromise(
                params,
                this._ws,
                writable
            )

            await this._closeWebSocketConnection()

            if (result instanceof Error) {
                if (!(result instanceof ChatHubError)) {
                    err = new ChatHubError(
                        ChatHubErrorCode.API_REQUEST_FAILED,
                        err
                    )
                } else {
                    err = result
                }
                try {
                    writable?.close()
                } catch (e) {}
            }
        })

        for await (const chunk of iterable) {
            // logger.debug(`chunk: ${chunk}`)
            if (err) {
                await this.dispose()
                throw err
            }

            if (chunk === '[DONE]') {
                return
            }

            yield new ChatGenerationChunk({
                text: chunk,
                message: new AIMessageChunk(chunk)
            })
        }

        if (err) {
            await this.dispose()
            throw err
        }
    }

    private _sendMessage(ws: WebSocket, params: ModelRequestParams) {
        const body: ChatCompletionRequest = {
            header: {
                app_id: this._config.appId
            },
            parameter: {
                chat: {
                    temperature: this._pluginConfig.temperature,
                    max_tokens: params.maxTokens,
                    top_k: 1,
                    domain: modelMapping[
                        params.model as keyof typeof modelMapping
                    ].model
                }
            },
            payload: {
                message: {
                    text: langchainMessageToSparkMessage(params.input)
                }
            }
        }

        ws.send(JSON.stringify(body))
    }

    private async _init(params: ModelRequestParams) {
        this._ws = await this._connectToWebSocket(
            modelMapping[params.model as keyof typeof modelMapping].wsUrl
        )
    }

    private async _connectToWebSocket(model: string): Promise<WebSocket> {
        const url = await this._getWebSocketUrl(model)
        logger.debug(`WebSocket URL: ${url}`)
        const socket = ws(url)
        return new Promise((resolve) => {
            socket.onopen = () => {
                logger.debug('WebSocket Connected')
                return resolve(socket)
            }
            socket.onerror = (error) => {
                logger.error('WebSocket Error:', error.message)
            }
        })
    }

    private async _getWebSocketUrl(model: string) {
        const apiKey = this._config.apiKey
        const apiSecret = this._config.apiSecret
        const url = new URL(`wss://spark-api.xf-yun.com/${model}/chat`)

        const host = url.host
        const date = new Date().toUTCString()

        const headers = 'host date request-line'
        const signatureOrigin = `host: ${host}\ndate: ${date}\nGET /${model}/chat HTTP/1.1`

        const signature = crypto
            .createHmac('sha256', apiSecret)
            .update(signatureOrigin)
            .digest('base64')

        const authorizationOrigin = `api_key="${apiKey}", algorithm="hmac-sha256", headers="${headers}", signature="${signature}"`

        const authorization =
            Buffer.from(authorizationOrigin).toString('base64')

        const urlParams = new URLSearchParams()

        urlParams.append('authorization', authorization)
        urlParams.append('host', host)
        urlParams.append('date', date)

        return url.href + '?' + urlParams.toString()
    }

    private async _buildListenerPromise(
        params: ModelRequestParams,
        ws: WebSocket,
        writable: WritableStreamDefaultWriter<string>
    ): Promise<string | Error> {
        this._sendMessage(ws, params)

        return new Promise((resolve, reject) => {
            let result = ''

            ws.onmessage = (e) => {
                const response = JSON.parse(
                    e.data.toString()
                ) as ChatCompletionResponse
                /*  writeFileSync('poe.json', JSON.stringify(jsonData)) */

                const message = response.payload?.choices?.text[0]

                const status = response.payload?.choices?.status

                if (status == null && message == null) {
                    return resolve(new Error(e.data.toString()))
                }

                result += message.content

                writable.write(result)

                if (status === 2) {
                    logger.debug(
                        `WebSocket Data Payload: ${JSON.stringify(response)}`
                    )
                    writable.write('[DONE]')
                    return resolve(result)
                }
            }
        })
    }

    private _closeWebSocketConnection(): Promise<boolean> {
        return new Promise((resolve, reject) => {
            this._ws.onclose = () => {
                resolve(true)
            }
            try {
                this._ws.close()
            } catch (e) {
                reject(e)
            }
        })
    }

    async dispose(): Promise<void> {}

    async init(): Promise<void> {}

    private _ws: WebSocket | null = null
}
