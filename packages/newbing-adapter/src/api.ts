import { createLogger } from '@dingyi222666/chathub-llm-core/lib/utils/logger'
import BingChatPlugin from '.'
import { BingChatResponse, ChatResponseMessage, ConversationInfo, ConversationResponse } from './types'
import { request } from "@dingyi222666/chathub-llm-core/lib/utils/request"
import { HEADERS, HEADERS_INIT_CONVER, buildChatRequest, serial, unpackResponse } from './constants'
import { BaseChatMessage, SystemChatMessage } from "langchain/schema"

const logger = createLogger('@dingyi222666/chathub-newbing-adapter/api')

export class Api {

    private _cookie: string

    constructor(private readonly _config: BingChatPlugin.Config) {
        this._cookie = _config.cookie
    }

    async createConversation(): Promise<ConversationResponse> {
        let resp: ConversationResponse
        try {
            resp = (await (await request.fetch('https://edgeservices.bing.com/edgesvc/turing/conversation/create', {
                headers: {
                    ...HEADERS_INIT_CONVER,
                    cookie: this._cookie
                }, redirect: 'error'
            })).json()) as ConversationResponse

            if (!resp.result) {
                throw new Error('Invalid response')
            }
        } catch (err) {
            throw new Error(`Failed to create conversation: ${err}`)
        }

        if (resp.result.value !== 'Success') {
            const message = `${resp.result.value}: ${resp.result.message}`
            if (resp.result.value === 'UnauthorizedRequest') {
                throw new Error("验证失败的请求，请检查你的 Cookie 或代理配置")
            }
            if (resp.result.value === 'Forbidden') {
                throw new Error(`请检查你的账户是否有权限使用 New Bing：${message}`)
            }
            throw new Error(message)
        }

        return resp
    }

    async sendMessage(
        conversationInfo: ConversationInfo,
        message: string,
        {
            sydney,
            previousMessages
        }: { previousMessages?: BaseChatMessage[], sydney: boolean } | null,
    ): Promise<ChatResponseMessage | Error> {

        const ws = request.ws('wss://sydney.bing.com/sydney/ChatHub', {
            headers: {
                ...HEADERS,
                //  cookie: this._cookie
            }
        })

        let interval: NodeJS.Timeout

        ws.once('open', () => {
            ws.send(serial({ protocol: "json", version: 1 }));


            interval = setInterval(() => {
                ws.send(serial({ type: 6 }))
                // same message is sent back on/after 2nd time as a pong
            }, 15 * 1000);
        });

        let replySoFar = ['']
        let messageCursor = 0
        let stopTokenFound = false;
        const stopToken = '\n\nuser:';

        const result = await (new Promise<ChatResponseMessage | Error>((resolve, reject) => {
            ws.on("message", (data) => {
                const events = unpackResponse(data.toString())

                const event = events[0]

                if (event?.item?.throttling?.maxNumUserMessagesInConversation) {
                    conversationInfo.maxNumUserMessagesInConversation = event?.item?.throttling?.maxNumUserMessagesInConversation
                }

                if (JSON.stringify(event) === '{}') {
                    ws.send(serial(buildChatRequest(conversationInfo, message, sydney, previousMessages)))

                    ws.send(serial({ type: 6 }))
                } else if (event.type === 1) {

                    if (stopTokenFound) {
                        return;
                    }

                    const messages = event.arguments[0].messages;

                    if (!messages?.length || messages[0].author !== 'bot' ||
                    !(messages[0].messageType !== null || messages[0].messageType === "InternalSearchQuery")) {
                        /*if (event?.arguments?.[0]?.throttling?. maxNumUserMessagesInConversation) {
                            maxNumUserMessagesInConversation = event?.arguments?.[0]?.throttling?.maxNumUserMessagesInConversation
                        } */
                        return
                    }
                    const updatedText = messages[0].text
                    if (!updatedText || updatedText === replySoFar[messageCursor]) {
                        return
                    }

                    // get the difference between the current text and the previous text
                    if (replySoFar[messageCursor] && updatedText.startsWith(replySoFar[messageCursor])) {
                        if (updatedText.trim().endsWith(stopToken)) {
                            // apology = true
                            // remove stop token from updated text
                            replySoFar[messageCursor] = updatedText.replace(stopToken, '').trim()

                            return
                        }
                        replySoFar[messageCursor] = updatedText
                    } else if (replySoFar[messageCursor]) {
                        messageCursor += 1
                        replySoFar.push(updatedText)
                    } else {
                        replySoFar[messageCursor] = replySoFar[messageCursor] + updatedText
                    }

                } else if (event.type === 2) {

                    const messages = event.item.messages as ChatResponseMessage[] | undefined

                    if (!messages) {
                        reject(event.item.result.error || `Unknown error: ${JSON.stringify(event)}`)
                        return
                    }

                    let eventMessage: ChatResponseMessage

                    for (let i = messages.length - 1; i >= 0; i--) {
                        const message = messages[i]
                        if (message.author === 'bot' && (message.messageType == null || message.messageType === "InternalSearchQuery")) {
                            eventMessage = messages[i]
                            break
                        }
                    }

                    const limited = messages.some((message) => message.contentOrigin === 'TurnLimiter')
                    if (limited) {
                        reject(new Error('Sorry, you have reached chat turns limit in this conversation.'))
                        return
                    }

                    if (event.item?.result?.error) {
                        logger.debug(JSON.stringify(event.item))

                        if (replySoFar[0] && eventMessage) {
                            eventMessage.adaptiveCards[0].body[0].text = replySoFar.join('\n\n');
                            eventMessage.text = eventMessage.adaptiveCards[0].body[0].text;
                            resolve(eventMessage);
                            return;
                        }

                        reject(new Error(`${event.item.result.value}: ${event.item.result.message}- ${event}`));

                        return;
                    }

                    if (!eventMessage) {
                        reject(new Error('No message was generated.'));
                        return;
                    }
                    if (eventMessage?.author !== 'bot') {
                        if (event.item?.result) {
                            if (event.item?.result?.exception?.indexOf('maximum context length') > -1) {
                                reject(new Error('long context with 8k token limit, please start a new conversation'))
                            } else if (event.item?.result.value === 'Throttled') {
                                reject(new Error('The account the SearchRequest was made with has been throttled.'))
                                logger.warn(JSON.stringify(event.item?.result))
                            } else if (eventMessage?.author === 'user') {
                                reject(new Error('The bing is end of the conversation. Try start a new conversation.'))
                            }
                            else {
                                logger.warn(JSON.stringify(event))
                                reject(new Error(`${event.item?.result.value}\n${event.item?.result.error}\n${event.item?.result.exception}`))
                            }
                        } else {
                            reject('Unexpected message author.')
                        }

                        return
                    }

                    // 自定义stopToken（如果是上下文续杯的话）
                    // The moderation filter triggered, so just return the text we have so far
                    if ((stopTokenFound || replySoFar[0] || event.item.messages[0].topicChangerText) && sydney) {
                        eventMessage.adaptiveCards[0].body[0].text = replySoFar.length < 1 ? eventMessage.spokenText : replySoFar.join('\n\n');
                        eventMessage.text = replySoFar.length < 1 ? eventMessage.spokenText : replySoFar.join('\n\n');;
                        // delete useless suggestions from moderation filter
                        delete eventMessage.suggestedResponses;
                    }

                    resolve(eventMessage);
                    return;
                } else if (event.type === 7) {
                    // [{"type":7,"error":"Connection closed with an error.","allowReconnect":true}]
                    ws.close()
                    reject(new Error("error: " + event.error || 'Connection closed with an error.'));
                    return;
                }

            })


            ws.on('error', err => reject(err));

        }))

        clearInterval(interval)

        if (!(result instanceof Error)) {
            conversationInfo.invocationId++
        }
        return result
    }
}
