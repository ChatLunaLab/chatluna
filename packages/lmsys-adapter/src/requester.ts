import {
    ModelRequester,
    ModelRequestParams
} from '@dingyi222666/koishi-plugin-chathub/lib/llm-core/platform/api'
import { WebSocket } from 'ws'
import { AIMessageChunk, ChatGenerationChunk } from 'langchain/schema'
import { createLogger } from '@dingyi222666/koishi-plugin-chathub/lib/utils/logger'
import {
    randomUA,
    ws
} from '@dingyi222666/koishi-plugin-chathub/lib/utils/request'
import { formatMessages, generateSessionHash, html2md, serial } from './utils'
import {
    ChatHubError,
    ChatHubErrorCode
} from '@dingyi222666/koishi-plugin-chathub/lib/utils/error'
import {
    FnIndex,
    LmsysClientConfig,
    PromiseConstructorParameters,
    ResponseTempParams
} from './types'
import { readableStreamToAsyncIterable } from '@dingyi222666/koishi-plugin-chathub/lib/utils/stream'

const logger = createLogger()

const STOP_TOKEN = ['\n\nuser:', '\n\nsystem:', 'user:', 'system:']

export class LMSYSRequester extends ModelRequester {
    private _conversationHash: string

    constructor(private _config: LmsysClientConfig) {
        super()
    }

    async *completionStream(
        params: ModelRequestParams
    ): AsyncGenerator<ChatGenerationChunk> {
        if (this._conversationHash == null) {
            await this.init()
        }

        await this._refreshConversation()

        let err: Error | null
        const stream = new TransformStream()

        const iterable = readableStreamToAsyncIterable<string>(stream.readable)

        const writable = stream.writable.getWriter()

        setTimeout(async () => {
            const result = await this._sendMessage(params, writable)

            if (result instanceof Error) {
                err = result
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
    }

    private _createWebSocket(): WebSocket {
        return ws('wss://chat.lmsys.org/queue/join', {
            headers: this._cookie
        })
    }

    async init(): Promise<void> {
        try {
            const conversationHash = generateSessionHash()

            const sendWebsocket = this._createWebSocket()

            await this._connectWebSocket(sendWebsocket, {
                conversationHash,
                fnIndex: FnIndex.InitSend,
                data: [{}],
                stopTokens: STOP_TOKEN
            })

            const receiveWebSocket = this._createWebSocket()

            sendWebsocket.on('close', (code, data) => {
                logger.debug(
                    `send websocket close with code: ${code}, data: ${data.toString()}`
                )
                if (data.toString() === '114514') {
                    logger.debug(`close receive websocket`)
                    receiveWebSocket.close()
                }
            })

            await this._connectWebSocket(receiveWebSocket, {
                conversationHash,
                fnIndex: FnIndex.InitReceive,
                // 固定 0.7 就好了。
                data: [],
                stopTokens: STOP_TOKEN
            })

            try {
                sendWebsocket.removeAllListeners()
                sendWebsocket.close()
            } catch {}

            this._conversationHash = conversationHash
        } catch (e) {
            throw new ChatHubError(
                ChatHubErrorCode.MODEL_CONVERSION_INIT_ERROR,
                e
            )
        }
    }

    private async _sendMessage(
        params: ModelRequestParams,
        stream: WritableStreamDefaultWriter<string>
    ): Promise<string | Error> {
        const sendMessage = this._config.formatMessages
            ? params.input[params.input.length - 1].content
            : await formatMessages(params.input)

        const sendWebsocket = this._createWebSocket()

        const conversationHash = this._conversationHash

        const stopTokens =
            params.stop instanceof Array
                ? params.stop.concat(STOP_TOKEN)
                : STOP_TOKEN.concat(params.stop)

        await this._connectWebSocket(sendWebsocket, {
            fnIndex: FnIndex.Send,
            data: [null, params.model, sendMessage],
            stopTokens,
            conversationHash
        })

        const receiveWebSocket = this._createWebSocket()

        sendWebsocket.on('close', (code, data) => {
            logger.debug(
                `send websocket close with code: ${code}, data: ${data.toString()}`
            )
            if (data.toString() === '114514') {
                logger.debug(`close receive websocket`)
                receiveWebSocket.close()
            }
        })

        const result = await this._connectWebSocket(
            receiveWebSocket,
            {
                conversationHash,
                fnIndex: FnIndex.Receive,
                // 固定 0.7 就好了。
                data: [null, 0.7, 1, 512],
                stopTokens
            },
            stream
        )

        try {
            sendWebsocket.removeAllListeners()
            sendWebsocket.close()
        } catch {}

        return result
    }

    private async _refreshConversation() {
        try {
            const conversationHash = generateSessionHash()

            const receiveWebSocket = this._createWebSocket()

            await this._connectWebSocket(receiveWebSocket, {
                conversationHash,
                fnIndex: FnIndex.Refresh,
                // 固定 0.7 就好了。
                data: [],
                stopTokens: STOP_TOKEN
            })

            this._conversationHash = conversationHash
        } catch (e) {
            await this.dispose()
            throw new ChatHubError(
                ChatHubErrorCode.MODEL_CONVERSION_INIT_ERROR,
                e
            )
        }
    }

    private async _connectWebSocket(
        websocket: WebSocket,
        params: Omit<ResponseTempParams, 'stopTokenFound' | 'result'>,
        writer?: WritableStreamDefaultWriter<string>
    ) {
        const tempParams: ResponseTempParams = {
            ...params,
            stopTokenFound: false,
            result: ''
        }

        const handleEventParams = {
            writer,
            ...tempParams
        }

        return new Promise<string>((resolve, reject) => {
            websocket.on('message', async (data) => {
                const event = JSON.parse(data.toString())

                await this._handleEventMessage(
                    event,
                    handleEventParams,
                    websocket,
                    {
                        resolve,
                        reject
                    }
                )
            })

            this._handleCloseEvent(websocket, tempParams, { resolve, reject })

            this._handleOpenEvent(websocket, tempParams, { resolve, reject })
        })
    }

    private _handleOpenEvent(
        websocket: WebSocket,
        { fnIndex }: ResponseTempParams,
        { resolve, reject }: PromiseConstructorParameters
    ) {
        websocket.on('open', () => {
            logger.debug(
                'WebSocket Connected: ' +
                    (fnIndex === FnIndex.Send ? 'send' : 'receive')
            )

            if (fnIndex === FnIndex.Send || fnIndex === FnIndex.InitSend) {
                resolve('')
            }
        })
    }

    private _handleCloseEvent(
        websocket: WebSocket,
        { result, fnIndex }: ResponseTempParams,
        { resolve, reject }: PromiseConstructorParameters
    ) {
        if (
            fnIndex === FnIndex.Receive ||
            fnIndex === FnIndex.InitReceive ||
            fnIndex === FnIndex.Refresh
        ) {
            websocket.on('close', (code, data) => {
                logger.debug('WebSocket Closed: receive')
                websocket.removeAllListeners()
                resolve(result)
            })
        }
    }

    private async _handleEventMessage(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        event: any,
        params: ResponseTempParams & {
            writer?: WritableStreamDefaultWriter<string>
        },
        websocket: WebSocket,
        { resolve, reject }: PromiseConstructorParameters
    ) {
        if (params.fnIndex !== FnIndex.Receive) {
            logger.debug(`event: ${JSON.stringify(event)}`)
        }

        const {
            conversationHash,
            fnIndex,
            data: sendData,
            stopTokenFound,
            writer
        } = params

        if (event.msg === 'send_hash') {
            //    logger.debug(`send_hash: ${conversationHash}, fnIndex: ${fnIndex}`)
            websocket.send(
                serial({ fn_index: fnIndex, session_hash: conversationHash })
            )
        } else if (event.msg === 'send_data') {
            websocket.send(
                serial({
                    fn_index: fnIndex,
                    data: sendData,
                    event_data: null,
                    session_hash: conversationHash
                })
            )
        } else if (event.msg === 'process_generating') {
            if (stopTokenFound) {
                await writer?.write('[DONE]')

                return
            }

            if (!event.success || !event.output.data) {
                await writer?.write('[DONE]')
                reject(
                    new Error(
                        event?.output?.error ?? 'process_generating error'
                    )
                )
                return
            }

            if (fnIndex !== FnIndex.Receive) {
                return
            }

            const outputData = event.output.data

            if (outputData[1] == null || outputData[1].length === 0) {
                return
            }

            const html = outputData[1][outputData[1].length - 1][1]

            let text = html2md(html)

            STOP_TOKEN.forEach((token) => {
                if (text.includes(token)) {
                    const startIndex = text.indexOf(token)
                    text = text
                        .substring(0, startIndex)
                        .replace(token, '')
                        .replace('▌', '')
                        .replace(/^(.+?)(:|：)\s?/, '')

                    params.result = text

                    params.stopTokenFound = true
                }
            })

            await writer?.write(
                text.replace('▌', '').replace(/^(.+?)(:|：)\s?/, '')
            )

            if (!params.stopTokenFound) {
                params.result = text
            }
        } else if (event.msg === 'queue_full') {
            await writer?.close()
            reject(new Error('queue full'))
        } else if (event.msg === 'process_completed') {
            try {
                if (event.success !== true) {
                    throw new Error(
                        event.output?.error ?? event ?? 'unknown error'
                    )
                }

                if (!event.output) {
                    return
                }

                if (event.output.is_generating === true) {
                    websocket.close(3001, '114514')
                }
            } finally {
                if (!stopTokenFound) {
                    await writer?.write('[DONE]')

                    try {
                        await writer?.close()
                    } catch (e) {
                        // why close?
                    }

                    params.stopTokenFound = true
                }
            }
        }
    }

    private _cookie = {
        'User-Agent': randomUA(),
        Host: 'chat.lmsys.org',

        Origin: 'https://chat.lmsys.org'
    }

    async dispose(): Promise<void> {
        this._conversationHash = null
    }
}
