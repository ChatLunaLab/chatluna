import {
    ModelRequester,
    ModelRequestParams
} from 'koishi-plugin-chatluna/lib/llm-core/platform/api'
import { WebSocket } from 'ws'
import {
    AIMessageChunk,
    BaseMessageChunk,
    ChatGenerationChunk,
    FunctionMessageChunk
} from 'langchain/schema'
import { createLogger } from 'koishi-plugin-chatluna/lib/utils/logger'
import { ws } from 'koishi-plugin-chatluna/lib/utils/request'
import crypto from 'crypto'
import {
    ChatLunaError,
    ChatLunaErrorCode
} from 'koishi-plugin-chatluna/lib/utils/error'
import { withResolver } from 'koishi-plugin-chatluna/lib/utils/promise'
import { readableStreamToAsyncIterable } from 'koishi-plugin-chatluna/lib/utils/stream'
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
        logger = createLogger(ctx, 'chatluna-spark-adapter')
    }

    async *completionStream(
        params: ModelRequestParams
    ): AsyncGenerator<ChatGenerationChunk> {
        await this._init(params)

        // await this._refreshConversation()

        let err: Error | null
        const stream = new TransformStream()

        const iterable = readableStreamToAsyncIterable<BaseMessageChunk>(
            stream.readable
        )

        const writable = stream.writable.getWriter()

        setTimeout(async () => {
            const result = await this._buildListenerPromise(
                params,
                this._ws,
                writable
            )

            await this._closeWebSocketConnection()

            if (result instanceof Error) {
                if (!(result instanceof ChatLunaError)) {
                    err = new ChatLunaError(
                        ChatLunaErrorCode.API_REQUEST_FAILED,
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

            if (chunk.content === '[DONE]') {
                return
            }

            yield new ChatGenerationChunk({
                text: chunk.content as string,
                message: chunk
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
                    domain:
                        modelMapping[params.model as keyof typeof modelMapping]
                            ?.model ?? 'general'
                }
            },
            payload: {
                message: {
                    text: langchainMessageToSparkMessage(
                        params.input,
                        params.model.includes('assistant')
                    )
                } /* ,
                functions: {
                    text:
                        params.tools != null
                            ? formatToolsToSparkTools(params.tools)
                            : undefined
                } */
            }
        }

        ws.send(JSON.stringify(body))
    }

    private async _init(params: ModelRequestParams) {
        this._ws = await this._connectToWebSocket(
            modelMapping[params.model as keyof typeof modelMapping]?.wsUrl ??
                params.model
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

    private async _getWebSocketUrlWithAssistant(model: string) {
        const apiKey = this._config.apiKey
        const apiSecret = this._config.apiSecret

        const url = new URL(
            `wss://spark-openapi.cn-huabei-1.xf-yun.com/v1/assistants/${model}`
        )

        const host = url.host
        const date = new Date().toUTCString()

        const headers = 'host date request-line'
        const signatureOrigin = `host: ${host}\ndate: ${date}\nGET /assistants/${model} HTTP/1.1`

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

    private async _getWebSocketUrl(model: string) {
        const apiKey = this._config.apiKey
        const apiSecret = this._config.apiSecret
        if (model.includes('assistant')) {
            return this._getWebSocketUrlWithAssistant(model.split(':')[1])
        }
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

    private _buildListenerPromise(
        params: ModelRequestParams,
        ws: WebSocket,
        writable: WritableStreamDefaultWriter<BaseMessageChunk>
    ): Promise<BaseMessageChunk | Error> {
        this._sendMessage(ws, params)

        const { promise, resolve } = withResolver<BaseMessageChunk | Error>()

        let chunk: BaseMessageChunk

        ws.onerror = (e) => {
            console.log(e)
            return resolve(new Error(e.message))
        }

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

            if (message.function_call) {
                chunk =
                    chunk ??
                    new FunctionMessageChunk({
                        name: '',
                        content: '',
                        additional_kwargs: {
                            function_call: {
                                name: '',
                                arguments: ''
                            }
                        }
                    })

                // eslint-disable-next-line @typescript-eslint/naming-convention
                const function_call = message.function_call

                if (function_call.name != null) {
                    chunk.additional_kwargs.function_call.name =
                        chunk.additional_kwargs.function_call.name +
                        function_call.name
                }

                if (function_call.arguments != null) {
                    chunk.additional_kwargs.function_call.arguments =
                        chunk.additional_kwargs.function_call.arguments +
                        function_call.arguments
                }

                chunk.name = chunk.additional_kwargs.function_call.name
            } else {
                chunk = chunk ?? new AIMessageChunk('')
                if (message.content != null) {
                    chunk.content = chunk.content + message.content
                }
            }

            writable.write(chunk)

            if (status === 2) {
                logger.debug(
                    `WebSocket Data Payload: ${JSON.stringify(response)}`
                )
                writable.write(new AIMessageChunk('[DONE]'))
                return resolve(chunk)
            }
        }

        return promise
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
