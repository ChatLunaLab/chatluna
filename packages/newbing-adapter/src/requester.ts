import {
    ModelRequester,
    ModelRequestParams
} from '@dingyi222666/koishi-plugin-chathub/lib/llm-core/platform/api'
import {
    ChatHubError,
    ChatHubErrorCode
} from '@dingyi222666/koishi-plugin-chathub/lib/utils/error'
import {
    runAsync,
    withResolver
} from '@dingyi222666/koishi-plugin-chathub/lib/utils/promise'
import {
    chathubFetch,
    FormData,
    ws
} from '@dingyi222666/koishi-plugin-chathub/lib/utils/request'
import { readableStreamToAsyncIterable } from '@dingyi222666/koishi-plugin-chathub/lib/utils/stream'
// import { diffChars } from 'diff'
import { Context } from 'koishi'
import {
    AIMessageChunk,
    BaseMessage,
    ChatGenerationChunk
} from 'langchain/schema'
import { WebSocket } from 'ws'
import { Config, logger } from '.'
import {
    buildChatRequest,
    HEADERS,
    KBLOB_HEADERS,
    randomString,
    serial,
    unpackResponse
} from './constants'
import {
    BingClientConfig,
    BingConversationStyle,
    ChatResponseMessage,
    ConversationInfo,
    ConversationResponse
} from './types'

export class BingRequester extends ModelRequester {
    private _headers: typeof HEADERS & Record<string, string> = { ...HEADERS }

    private _wsUrl = 'wss://sydney.bing.com/sydney/ChatHub'

    private _createConversationUrl =
        'https://edgeservices.bing.com/edgesvc/turing/conversation/create'

    private _currentConversation: ConversationInfo

    private _isThrottled = false

    private _cookie: string

    constructor(
        private ctx: Context,
        private _pluginConfig: Config,
        private _chatConfig: BingClientConfig,
        private _style: BingConversationStyle
    ) {
        super()

        let cookie =
            _chatConfig.apiKey.length < 1
                ? `_U=${randomString(169)}`
                : _chatConfig.apiKey

        if (!cookie.includes('_U=')) {
            cookie = `_U=${cookie}`
        }

        if (_pluginConfig.webSocketApiEndPoint.length > 0) {
            this._wsUrl = _pluginConfig.webSocketApiEndPoint
        }

        if (_pluginConfig.createConversationApiEndPoint.length > 0) {
            this._createConversationUrl =
                _pluginConfig.createConversationApiEndPoint
        }

        this._cookie = cookie
        this._headers.cookie = cookie

        //   this._headers['User-Agent'] = this._ua
    }

    async *completionStream(
        params: ModelRequestParams
    ): AsyncGenerator<ChatGenerationChunk> {
        if (this._isThrottled === true) {
            this._chatConfig.sydney = false
        }

        await this.init()

        let err: Error | null
        const stream = new TransformStream()

        const iterable = readableStreamToAsyncIterable<string>(stream.readable)

        const writable = stream.writable.getWriter()

        runAsync(async () => {
            const result = await this._sendMessage(params, writable)

            if (result instanceof Error) {
                try {
                    writable.close()
                } catch {}
                err = result
            }
        })

        for await (const chunk of iterable) {
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
            throw err
        }
    }

    private async _sendMessage(
        params: ModelRequestParams,
        writable: WritableStreamDefaultWriter<string>
    ): Promise<Error | string> {
        const socket = ws(
            this._wsUrl +
                '?sec_access_token=' +
                encodeURIComponent(this._currentConversation.accessToken),
            {
                headers: {
                    ...HEADERS,
                    cookie: this._cookie
                }
            }
        )

        let interval: NodeJS.Timeout

        socket.once('open', () => {
            socket.send(serial({ protocol: 'json', version: 1 }))

            interval = setInterval(() => {
                socket.send(serial({ type: 6 }))
                // same message is sent back on/after 2nd time as a pong
            }, 15 * 1000)
        })

        let result: string | Error

        try {
            result = await this._buildPromise(params, socket, writable)
        } catch (error) {
            result = error
        }

        clearInterval(interval)

        if (!(result instanceof Error)) {
            await writable.write('[DONE]')
            this._currentConversation.invocationId++
        }

        return result
    }

    private _buildPromise(
        params: ModelRequestParams,
        ws: WebSocket,
        writable: WritableStreamDefaultWriter<string>
    ): Promise<string> {
        const { promise, resolve, reject } = withResolver<string>()

        const replySoFar = ['']
        let messageCursor = 0
        let stopTokenFound = false

        const conversationInfo = this._currentConversation
        const message = params.input.pop()
        const sydney = this._chatConfig.sydney
        const previousMessages = params.input

        const stopToken = '\n\nuser:'

        ws.on('message', async (data) => {
            const events = unpackResponse(data.toString())

            const event = events[0]

            if (event?.item?.throttling?.maxNumUserMessagesInConversation) {
                conversationInfo.maxNumUserMessagesInConversation =
                    event?.item?.throttling?.maxNumUserMessagesInConversation
            }

            if (JSON.stringify(event) === '{}') {
                let imageUrl: string

                try {
                    if (!this._pluginConfig.sydney) {
                        imageUrl = await this._uploadAttachment(message)
                    }
                } catch (e) {
                    reject(e)
                }

                ws.send(
                    serial(
                        buildChatRequest(
                            conversationInfo,
                            message,
                            sydney,
                            previousMessages,
                            imageUrl
                        )
                    )
                )

                ws.send(serial({ type: 6 }))
            } else if (event.type === 1) {
                if (stopTokenFound) {
                    return
                }

                const messages = event.arguments[0].messages
                const message: ChatResponseMessage = messages?.length
                    ? messages[messages.length - 1]
                    : undefined

                // logger.debug(`Received message: ${JSON.stringify(message)}`)

                if (!message || message.author !== 'bot') {
                    logger.debug(
                        `Breaking because message is null or author is not bot: ${JSON.stringify(
                            message
                        )}`
                    )
                    return
                }

                if (message.contentOrigin === 'Apology') {
                    // apology
                    return
                }

                if (
                    sydney === true &&
                    message.messageType !== 'Suggestion' &&
                    message.messageType != null
                ) {
                    return
                }

                if (message.messageType != null && sydney === false) {
                    return
                }

                /* if (event?.arguments?.[0]?.throttling?. maxNumUserMessagesInConversation) {
                        maxNumUserMessagesInConversation = event?.arguments?.[0]?.throttling?.maxNumUserMessagesInConversation
                    } */

                const updatedText = message.text.trim()

                /*  const diffs = diffChars(replySoFar[messageCursor], updatedText)
                 */
                // console.log(diffs)

                if (!updatedText || updatedText === replySoFar[messageCursor]) {
                    return
                }

                // get the difference between the current text and the previous text
                if (
                    replySoFar[messageCursor] &&
                    updatedText.startsWith(replySoFar[messageCursor])
                ) {
                    if (updatedText.trim().endsWith(stopToken)) {
                        // apology = true
                        // remove stop token from updated text
                        stopTokenFound = true
                        replySoFar[messageCursor] = updatedText
                            .replace(stopToken, '')
                            .trim()

                        await writable.write(replySoFar.join('\n\n'))

                        return
                    }
                    replySoFar[messageCursor] = updatedText
                } /* else if (
                    updatedText.startsWith(replySoFar[messageCursor]) &&
                    diffs[diffs.length - 1].removed &&
                    diffs[diffs.length - 1].value.replaceAll(/\s\n\t/g, '')
                        .length < 1
                ) {
                    return
                } */ else if (replySoFar[messageCursor]) {
                    messageCursor += 1

                    replySoFar.push(updatedText)
                } else {
                    replySoFar[messageCursor] =
                        replySoFar[messageCursor] + updatedText
                }

                await writable.write(replySoFar.join('\n\n'))
            } else if (event.type === 2) {
                const messages = event.item.messages as
                    | ChatResponseMessage[]
                    | undefined

                if (!messages) {
                    const errorMessage =
                        event.item.result.error ??
                        `Unknown error: ${JSON.stringify(event)}`

                    const needCaptcha = errorMessage.includes(
                        'User needs to solve CAPTCHA to continue'
                    )

                    reject(
                        new ChatHubError(
                            needCaptcha
                                ? ChatHubErrorCode.API_REQUEST_RESOLVE_CAPTCHA
                                : ChatHubErrorCode.API_REQUEST_FAILED,
                            new Error(errorMessage)
                        )
                    )
                    return
                }

                let eventMessage: ChatResponseMessage

                for (let i = messages.length - 1; i >= 0; i--) {
                    const message = messages[i]
                    if (
                        message.author === 'bot' &&
                        message.messageType == null
                    ) {
                        eventMessage = messages[i]
                        break
                    }
                }

                const limited = messages.some(
                    (message) => message.contentOrigin === 'TurnLimiter'
                )

                if (limited) {
                    reject(
                        new Error(
                            'Sorry, you have reached chat turns limit in this conversation.'
                        )
                    )
                    return
                }

                if (event.item?.result?.error) {
                    logger.debug(JSON.stringify(event.item))

                    if (replySoFar[0] && eventMessage) {
                        eventMessage.adaptiveCards[0].body[0].text =
                            replySoFar.join('\n\n')
                        eventMessage.text =
                            eventMessage.adaptiveCards[0].body[0].text

                        resolve(eventMessage.text)
                        return
                    }

                    reject(
                        new Error(
                            `${event.item.result.value}: ${event.item.result.message} - ${event}`
                        )
                    )

                    return
                }

                if (!eventMessage) {
                    reject(new Error('No message was generated.'))
                    return
                }
                if (eventMessage?.author !== 'bot') {
                    if (!event.item?.result) {
                        reject(Error('Unexpected message author.'))
                        return
                    }

                    if (
                        event.item?.result?.exception?.indexOf(
                            'maximum context length'
                        ) > -1
                    ) {
                        reject(
                            new Error(
                                'long context with 8k token limit, please start a new conversation'
                            )
                        )
                    } else if (event.item?.result.value === 'Throttled') {
                        logger.warn(JSON.stringify(event.item?.result))
                        this._isThrottled = true
                        reject(
                            new Error(
                                'The account the SearchRequest was made with has been throttled.'
                            )
                        )
                    } else if (eventMessage?.author === 'user') {
                        reject(
                            new Error(
                                'The bing is end of the conversation. Try start a new conversation.'
                            )
                        )
                    } else {
                        logger.warn(JSON.stringify(event))
                        reject(
                            new Error(
                                `${event.item?.result.value}\n${event.item?.result.error}\n${event.item?.result.exception}`
                            )
                        )
                    }

                    return
                }

                // 自定义 stopToken（如果是上下文续杯的话）
                // The moderation filter triggered, so just return the text we have so far
                if (
                    stopTokenFound ||
                    replySoFar[0] /* || event.item.messages[0].topicChangerText) */ ||
                    sydney
                ) {
                    eventMessage.adaptiveCards =
                        eventMessage.adaptiveCards || []
                    eventMessage.adaptiveCards[0] = eventMessage
                        .adaptiveCards[0] || {
                        type: 'AdaptiveCard',
                        body: [
                            {
                                type: 'TextBlock',
                                wrap: true,
                                text: ''
                            }
                        ],
                        version: '1.0'
                    }
                    eventMessage.adaptiveCards[0].body =
                        eventMessage.adaptiveCards[0].body || []
                    eventMessage.adaptiveCards[0].body[0] = eventMessage
                        .adaptiveCards[0].body[0] || {
                        type: 'TextBlock',
                        wrap: true,
                        text: ''
                    }
                    const text =
                        replySoFar.length < 1 || replySoFar[0].length < 1
                            ? eventMessage.spokenText ?? eventMessage.text
                            : replySoFar.join('\n\n')
                    eventMessage.adaptiveCards[0].body[0].text = text
                    eventMessage.text =
                        eventMessage.adaptiveCards[0].body[0].text
                    // delete useless suggestions from moderation filter
                    delete eventMessage.suggestedResponses
                }

                resolve(eventMessage.requestId)
            } else if (event.type === 7) {
                // [{"type":7,"error":"Connection closed with an error.","allowReconnect":true}]
                ws.close()
                reject(
                    new Error(
                        'error: ' + event.error ||
                            'Connection closed with an error.'
                    )
                )
            }
        })

        ws.on('error', (err) => {
            reject(err)
        })

        return promise
    }

    private async _uploadAttachment(message: BaseMessage): Promise<string> {
        const image: string = message.additional_kwargs?.['images']?.[0]

        if (!image) {
            return null
        }

        const imageData = image.replace(/^data:image\/\w+;base64,/, '')

        const payload = {
            knowledgeRequest: JSON.stringify({
                imageInfo: {},
                knowledgeRequest: {
                    invokedSkills: ['ImageById'],
                    subscriptionId: 'Bing.Chat.Multimodal',
                    invokedSkillsRequestData: { enableFaceBlur: true },
                    convoData: {
                        convoid:
                            this._currentConversation.invocationId > 0
                                ? this._currentConversation.conversationId
                                : undefined,
                        convotone: this._currentConversation.conversationStyle
                    }
                }
            }),
            imageBase64: imageData
        }

        const formData = new FormData()

        formData.append('knowledgeRequest', payload.knowledgeRequest)
        formData.append('imageBase64', payload.imageBase64)

        const response = await chathubFetch(
            'https://www.bing.com/images/kblob',
            {
                method: 'POST',
                body: formData,
                headers: {
                    ...KBLOB_HEADERS,
                    cookie: this._cookie
                },
                redirect: 'error'
            }
        )

        if (response.status !== 200) {
            throw new Error(
                `Failed to upload image: ${response.status} ${
                    response.statusText
                }
                    ${await response.text()}
                }`
            )
        }

        const responseJson = (await response.json()) as {
            blobId: string
            processedBlobId: string
        }

        if (responseJson.blobId == null || responseJson.blobId.length < 1) {
            throw new Error(
                `Failed to upload image: ${JSON.stringify(responseJson)}`
            )
        }

        const url = `https://www.bing.com/images/blob?bcid=${responseJson.blobId}`

        logger.debug(`Uploaded image to ${url}`)

        return url
    }

    async dispose(): Promise<void> {
        this._currentConversation = null
    }

    async init(): Promise<void> {
        if (this._currentConversation == null || this._chatConfig.sydney) {
            const conversationResponse = await this._createConversation()
            this._currentConversation = {
                conversationId: conversationResponse.conversationId,
                invocationId: 0,
                accessToken: conversationResponse.accessToken,
                clientId: conversationResponse.clientId,
                conversationSignature:
                    conversationResponse.conversationSignature,
                conversationStyle: this._style
            }
        }
    }

    private async _createConversation(): Promise<ConversationResponse> {
        let resp: ConversationResponse
        try {
            const response = await chathubFetch(this._createConversationUrl, {
                headers: {
                    ...HEADERS,
                    cookie: this._cookie
                },
                redirect: 'error'
            })

            resp = (await response.json()) as ConversationResponse

            const accessToken = response.headers.get(
                'X-Sydney-Encryptedconversationsignature'
            )

            const conversationSignature = response.headers.get(
                'X-Sydney-Conversationsignature'
            )

            if (!resp.result) {
                throw new ChatHubError(
                    ChatHubErrorCode.MODEL_CONVERSION_INIT_ERROR,
                    new Error(resp as unknown as string)
                )
            }

            resp.accessToken = accessToken
            resp.conversationSignature =
                resp.conversationSignature ?? conversationSignature

            logger.debug(
                `Create conversation response: ${JSON.stringify(resp)}`
            )
        } catch (err) {
            throw new ChatHubError(
                ChatHubErrorCode.MODEL_CONVERSION_INIT_ERROR,
                err
            )
        }

        if (resp.result.value !== 'Success') {
            logger.debug(
                `Failed to create conversation: ${JSON.stringify(resp)}`
            )
            const message = `${resp.result.value}: ${resp.result.message}`
            throw new ChatHubError(
                ChatHubErrorCode.MODEL_CONVERSION_INIT_ERROR,
                new Error(message)
            )
        }

        return resp
    }
}
