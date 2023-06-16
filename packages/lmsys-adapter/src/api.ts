import { createLogger } from '@dingyi222666/koishi-plugin-chathub/lib/llm-core/utils/logger'
import LmsysPlugin from '.'
import { WebSocket } from 'ws'
import { request } from "@dingyi222666/koishi-plugin-chathub/lib/llm-core/utils/request"
import { BaseChatMessage } from "langchain/schema"
import { formatMessages, html2md, serial } from './utils'
import { FnIndex } from "./types"

const logger = createLogger('@dingyi222666/chathub-lmsys-adapter/api')

const STOP_TOKEN = ["\n\nuser:", "\n\nsystem:", "user:", "system:"]

export class Api {


    private _cookie = {
        'User-Agent': request.randomUA()
    }

    constructor(private readonly _modelName: string) {
        logger.debug(`create lmsys api with model name: ${_modelName}`)
    }

    async sendMessage(
        conversationHash: string,
        message: string,
        previousMessages?: BaseChatMessage[],
    ): Promise<string | Error> {

        const sendMessage = previousMessages ?
            await formatMessages(previousMessages, async (text) => text.length / 4, 1860) : message

        const sendWebsocket = this._createWebSocket()

        await this._connectWebSocket(sendWebsocket, {
            conversationHash,
            fnIndex: FnIndex.Send,
            data: [null, this._modelName, sendMessage],
        })

        const receiveWebSocket = this._createWebSocket()

        sendWebsocket.on("close", (code, data) => {
            logger.debug(`send websocket close with code: ${code}, data: ${data.toString()}`)
            if (data.toString() === "114514") {
                logger.debug(`close receive websocket`)
                receiveWebSocket.close()
            }
        })

        let result = await this._connectWebSocket(receiveWebSocket, {
            conversationHash,
            fnIndex: FnIndex.Receive,
            // 固定 0.7 就好了。
            data: [null, 0.7, 1, 512],
        })


        try {
            sendWebsocket.removeAllListeners()
            sendWebsocket.close()
        } catch {

        }

        // regex match starts with xxxxx(:|：)
        if (result.match(/^(.+?)(:|：)\s?/)) {
            result = result.replace(/^(.+?)(:|：)\s?/, '')
        }

        return result

    }

    async initConversation(conversationHash: string): Promise<void> {
        const sendWebsocket = this._createWebSocket()

        await this._connectWebSocket(sendWebsocket, {
            conversationHash,
            fnIndex: FnIndex.InitSend,
            data: [{}],
        })

        const receiveWebSocket = this._createWebSocket()

        sendWebsocket.on("close", (code, data) => {
            logger.debug(`send websocket close with code: ${code}, data: ${data.toString()}`)
            if (data.toString() === "114514") {
                logger.debug(`close receive websocket`)
                receiveWebSocket.close()
            }
        })

        await this._connectWebSocket(receiveWebSocket, {
            conversationHash,
            fnIndex: FnIndex.InitReceive,
            // 固定 0.7 就好了。
            data: [],
        })


        try {
            sendWebsocket.removeAllListeners()
            sendWebsocket.close()
        } catch {

        }
    }

    private async _connectWebSocket(
        websocket: WebSocket,
        {
            conversationHash,
            fnIndex,
            data: sendData,
        }: {
            conversationHash: string,
            fnIndex: number,
            data: unknown[]
        }
    ) {
        let result = ''

        let stopTokenFound = false

        return new Promise<string>((resolve, reject) => {
            websocket.on("message", (data) => {
               /*  logger.debug(`receive message on fnIndex: ${fnIndex}, data: ${data.toString()}`)
 */
                const event = JSON.parse(data.toString())

                if (event.msg === 'send_hash') {
                    //    logger.debug(`send_hash: ${conversationHash}, fnIndex: ${fnIndex}`)
                    websocket.send(serial({ fn_index: fnIndex, session_hash: conversationHash }))
                } else if (event.msg === 'send_data') {

                    websocket.send(serial({
                        fn_index: fnIndex,
                        data: sendData,
                        event_data: null,
                        session_hash: conversationHash,
                    }))

                    //   logger.debug(`send_data: ${JSON.stringify(sendData)}, fnIndex: ${fnIndex}`)

                } else if (event.msg === 'process_generating') {

                    if (stopTokenFound) {
                        return
                    }

                    if (!event.success || !event.output.data) {
                        reject(new Error(event?.output?.error ?? 'process_generating error'))
                        return
                    }

                    if (fnIndex !== FnIndex.Receive) {
                        return
                    }

                    const outputData = event.output.data

                    // logger.debug(`outputData: ${JSON.stringify(outputData)}`)

                    if (outputData[1] == null || outputData[1].length === 0) {
                        return;
                    }

                    const html = outputData[1][outputData[1].length - 1][1]

                    let text = html2md(html)

                    logger.debug(`receive message: ${text}`)

                    STOP_TOKEN.forEach(token => {
                        if (text.includes(token)) {
                            const startIndex = text.indexOf(token)
                            text = text.substring(0, startIndex)
                                .replace(token, '')
                                .replace('▌', '')

                            result = text

                            stopTokenFound = true
                        }

                    })

                    if (!stopTokenFound) {
                        result = text
                    }

                }
                else if (event.msg === 'queue_full') {
                    reject(new Error('queue full'))
                } else if (event.msg === 'process_completed') {
                    if (event.success !== true) {
                        throw new Error(event.output?.error ?? "unknown error")
                    }

                    if (!event.output) {
                        return
                    }

                    if (event.output.is_generating === true) {
                        websocket.close(3001, "114514")
                    } else if (event.success === false) {
                        throw new Error(event.output?.error ?? "unknown error")
                    }

                }
            })

            if (fnIndex === FnIndex.Receive || fnIndex == FnIndex.InitReceive) {
                websocket.on("close", (code, data) => {
                    logger.debug('WebSocket Closed: receive')
                    websocket.removeAllListeners()
                    resolve(result)
                })
            }

            websocket.on("open", () => {
                logger.debug('WebSocket Connected: ' + (fnIndex === FnIndex.Send ? 'send' : 'receive'))

                if (fnIndex === FnIndex.Send || fnIndex === FnIndex.InitSend) {
                    resolve('ok')
                }
            })

        })
    }

    private _createWebSocket(): WebSocket {
        return request.ws("wss://chat.lmsys.org/queue/join", {
            headers: this._cookie
        })
    }

}
