import { Context, Dict, Logger, Quester } from 'koishi'
import OpenAIAdapter from "./index"
import { ConversationResponse, ApiRequest, BingMessage, ApiResponse } from './types'
import { Conversation, createLogger } from '@dingyi222666/koishi-plugin-chathub'
import NewBingAdapter from './index'
import { v4 as uuidv4 } from "uuid"
import { HttpsProxyAgent } from 'https-proxy-agent';
import { ProxyAgent, fetch } from 'undici';
import { RawData, WebSocket } from 'ws'


const logger = createLogger('@dingyi222666/chathub-newbing-adapter/api')

/**
 * https://stackoverflow.com/a/58326357
 * @param {number} size
 */
const genRanHex = (size) => [...Array(size)].map(() => Math.floor(Math.random() * 16).toString(16)).join('')


export class Api {

    private bingPingInterval: NodeJS.Timer;

    private proxyHost: string
    private cookie: string

    private ws: WebSocket;

    private isThrottled: boolean = false

    constructor(
        public config: NewBingAdapter.Config,
        public ctx: Context
    ) {
        this.proxyHost = config.bingProxy ?? ctx.http.config.proxyAgent

        if (this.proxyHost != null && this.proxyHost.length ==0) {
            this.proxyHost = null
        }
        this.cookie = config.cookie
    }

    private buildHeaders() {
        const result: any = {
            headers: {
                accept: 'application/json',
                'accept-language': 'en-US,en;q=0.9',
                'content-type': 'application/json',
                'sec-ch-ua': '"Chromium";v="112", "Microsoft Edge";v="112", "Not:A-Brand";v="99"',
                'sec-ch-ua-arch': '"x86"',
                'sec-ch-ua-bitness': '"64"',
                'sec-ch-ua-full-version': '"112.0.1722.7"',
                'sec-ch-ua-full-version-list': '"Chromium";v="112.0.5615.20", "Microsoft Edge";v="112.0.1722.7", "Not:A-Brand";v="99.0.0.0"',
                'sec-ch-ua-mobile': '?0',
                'sec-ch-ua-model': '""',
                'sec-ch-ua-platform': '"Windows"',
                'sec-ch-ua-platform-version': '"15.0.0"',
                'sec-fetch-dest': 'empty',
                'sec-fetch-mode': 'cors',
                'sec-fetch-site': 'same-origin',
                'x-ms-client-request-id': uuidv4(),
                'x-ms-useragent': 'azsdk-js-api-client-factory/1.0.0-beta.1 core-rest-pipeline/1.10.0 OS/Win32',
                cookie: this.cookie,
                Referer: 'https://www.bing.com/search?q=Bing+AI&showconv=1&FORM=hpcodx',
                "Access-Control-Allow-Origin": "*",
                'Referrer-Policy': 'origin-when-cross-origin',
                // Workaround for request being blocked due to geolocation
                'x-forwarded-for': '1.1.1.1',
            }
        };

        if (this.proxyHost) {
            result.dispatcher = new ProxyAgent(this.proxyHost)
        }
        return result
    }

    private async cleanupWebSocketConnection() {
        const ws = this.ws
        if (this.bingPingInterval) {
            clearInterval(this.bingPingInterval)
            this.bingPingInterval = null
        }
        ws.close()
        ws.removeAllListeners()
        this.ws = null
    }

    private async createNewConversation(): Promise<ConversationResponse> {
        const response = await fetch(`https://www.bing.com/turing/conversation/create`, this.buildHeaders());

        const { status, headers } = response;

        logger.debug(`createNewConversation: status=${status}, headers=${JSON.stringify(headers)}`);

        if (status === 200 && +headers['content-length'] < 5) {
            throw new Error('/turing/conversation/create: Your IP is blocked by BingAI.');
        }

        const body = await response.text()
        try {
            return JSON.parse(body);
        } catch (err) {
            throw new Error(`/turing/conversation/create: failed to parse response body.\n${body}`);
        }
    }

    private getToneStyleToRequest(toneStyle: string) {
        if (toneStyle === 'creative') {
            return 'h3imaginative';
        } else if (toneStyle === 'precise') {
            return 'h3precise';
        } else if (toneStyle === 'fast') {
            // new "Balanced" mode, allegedly GPT-3.5 turbo
            return 'galileo';
        } else {
            // old "Balanced" mode
            return 'harmonyv3';
        }
    }


    private buildWebSocketRequestData(
        {
            toneStyle,
            bingConversation: {
                conversationId,
                invocationId,
                conversationSignature,
                clientId,
            },
            sydney,
            prompt
        }: ApiRequest,
    ) {
        const result = {
            arguments: [
                {
                    source: 'cib',
                    optionsSets: [
                        'nlu_direct_response_filter',
                        'deepleo',
                        'disable_emoji_spoken_text',
                        'responsible_ai_policy_235',
                        'enablemm',
                        this.getToneStyleToRequest(toneStyle),
                        'dtappid',
                        'cricinfo',
                        'cricinfov2',
                        'dv3sugg',
                    ],
                    sliceIds: [
                        '222dtappid',
                        '225cricinfo',
                        '224locals0',
                    ],
                    traceId: genRanHex(32),
                    isStartOfSession: invocationId === 0,
                    message: {
                        author: 'user',
                        text: sydney ? '' : prompt,
                        messageType: sydney ? 'SearchQuery' : 'Chat',
                    },
                    conversationSignature,
                    participant: {
                        id: clientId,
                    },
                    conversationId,
                    previousMessages: [],
                },
            ],
            invocationId: invocationId.toString(),
            target: 'chat',
            type: 4,
        };

        if (sydney) {
            const previousMessages: BingMessage[] = []
            previousMessages.push({
                author: 'user',
                description: prompt,
                contextType: 'WebPage',
                messageType: 'Context',
                messageId: 'discover-web--page-ping-mriduna-----',
            })
            result.arguments[0].previousMessages = previousMessages
        }

        if (result.arguments[0].previousMessages.length == 0) {
            delete result.arguments[0].previousMessages
        }

        return result
    }


    async createWebSocketConnection(): Promise<WebSocket> {
        return new Promise((resolve, reject) => {

            // 判断不了readState，算了，直接重连
            /* if (this.ws != undefined) {
                resolve(this.ws)
                return
            } */

            const ws = new WebSocket(`wss://sydney.bing.com/sydney/ChatHub`, { agent: this.proxyHost ? new HttpsProxyAgent(this.proxyHost) : undefined })

            ws.on('error', err => reject(err));

            ws.on('open', () => {
                logger.debug('bing ai: performing handshake');

                ws.send('{"protocol":"json","version":1}');

            });

            ws.on('close', () => {
                logger.debug('disconnected');
            });


            let listener: (this: WebSocket, data: RawData, isBirany: boolean) => void;

            listener = (data) => {
                const objects = data.toString().split('');
                const messages = objects.map((object) => {
                    try {
                        return JSON.parse(object);
                    } catch (error) {
                        return object;
                    }
                }).filter(message => message);
                if (messages.length === 0) {
                    return;
                }
                if (typeof messages[0] === 'object' && Object.keys(messages[0]).length === 0) {
                    logger.debug('bing ai: handshake established');
                    // ping

                    this.bingPingInterval = setInterval(() => {
                        ws.send('{"type":6}');
                        // same message is sent back on/after 2nd time as a pong
                    }, 15 * 1000);
                    this.ws = ws
                    ws.removeListener('message', listener);
                    resolve(ws);
                }
            }

            ws.on('message', listener);
        });
    }


    /**
     * Connect to bing api
     */
    async connect(): Promise<void> {

        this.ws = await this.createWebSocketConnection()

        this.ws.on('error', (error) => {
            logger.error(error);
            this.cleanupWebSocketConnection()
        });
    }

    reset() {
        if (this.ws) {
            this.cleanupWebSocketConnection()
        }
    }

    async request(request: ApiRequest): Promise<ApiResponse | Error> {

        if (this.isThrottled) {
            // 强制关闭sydney模式
            request.sydney = false
        }

        let {
            conversationId,
            conversationSignature,
            clientId,
            invocationId = 0
        } = request.bingConversation


        //  const progress = options.onProgress ?? (() => { })

        if (request.sydney || !conversationSignature || !conversationId || !clientId) {
            // 这里是创建对话的逻辑
            const createNewConversationResponse = await this.createNewConversation();

            logger.debug(`createNewConversationResponse: ${JSON.stringify(createNewConversationResponse)}`);
            if (
                !createNewConversationResponse.conversationSignature
                || !createNewConversationResponse.conversationId
                || !createNewConversationResponse.clientId
            ) {
                const resultValue = createNewConversationResponse.result?.value;
                if (resultValue) {
                    const e = new Error(createNewConversationResponse.result.message); // default e.name is 'Error'
                    e.name = resultValue; // such as "UnauthorizedRequest"
                    throw e;
                }
                throw new Error(`Unexpected response:\n${JSON.stringify(createNewConversationResponse, null, 2)}`);
            }
            ({
                conversationSignature,
                conversationId,
                clientId,
            } = createNewConversationResponse);
        }


        const stopToken = '\n\n[user](#message)';

        const ws = await this.createWebSocketConnection();

        const abortController = new AbortController();

        ws.on('error', (error) => {
            logger.error(error);
            this.cleanupWebSocketConnection();
            abortController.abort();
        });


        const messagePromise: Promise<{ reply: any, conversationExpiryTime: number, response: any } | Error> = new Promise((resolve, reject) => {
            let replySoFar = '';
            let stopTokenFound = false;

            // let maxNumUserMessagesInConversation = 5;

            const messageTimeout = setTimeout(() => {
                this.cleanupWebSocketConnection();
                reject(new Error('Timed out waiting for response. Try enabling debug mode to see more information.'));
            }, this.config.timeout ?? 120 * 1000);

            // abort the request if the abort controller is aborted
            abortController.signal.addEventListener('abort', () => {
                clearTimeout(messageTimeout);
                this.cleanupWebSocketConnection();
                reject(new Error('Request aborted'));
            });

            ws.on('message', (data) => {
                const objects = data.toString().split('');
                const events = objects.map((object) => {
                    try {
                        return JSON.parse(object);
                    } catch (error) {
                        return object;
                    }
                }).filter(eventMessage => eventMessage);
                if (events.length === 0) {
                    return;
                }
                const event = events[0];

                switch (event.type) {
                    case 1: {
                        if (stopTokenFound) {
                            return;
                        }
                        const messages = event?.arguments?.[0]?.messages;
                        if (!messages?.length || messages[0].author !== 'bot') {
                            /*if (event?.arguments?.[0]?.throttling?. maxNumUserMessagesInConversation) {
                                maxNumUserMessagesInConversation = event?.arguments?.[0]?.throttling?.maxNumUserMessagesInConversation
                            } */
                            return
                        }
                        const updatedText = messages[0].text;
                        if (!updatedText || updatedText === replySoFar) {
                            return;
                        }
                        // get the difference between the current text and the previous text
                        // const difference = updatedText.substring(replySoFar.length);
                        // progress(difference);
                        if (updatedText.trim().endsWith(stopToken)) {
                            stopTokenFound = true;
                            // remove stop token from updated text
                            replySoFar = updatedText.replace(stopToken, '').trim();
                            return;
                        }
                        replySoFar = updatedText;
                        return;
                    }
                    case 2: {
                        clearTimeout(messageTimeout);
                        if (event.item?.result?.value === 'InvalidSession') {
                            reject(new Error(`${event.item.result.value}: ${event.item.result.message} - ${event}`));
                            return;
                        }
                        const messages = event.item?.messages || [];
                        const eventMessage = messages.length ? messages[messages.length - 1] : null;
                        if (event.item?.result?.error) {

                            logger.debug(event.item.result.value, event.item.result.message);
                            logger.debug(event.item.result.error);
                            logger.debug(event.item.result.exception);

                            if (replySoFar && eventMessage) {
                                eventMessage.adaptiveCards[0].body[0].text = replySoFar;
                                eventMessage.text = replySoFar;
                                resolve({
                                    reply: eventMessage,
                                    conversationExpiryTime: event?.item?.conversationExpiryTime,
                                    response: event
                                });
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
                                } else if (eventMessage?.author == 'user') {
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
                        // The moderation filter triggered, so just return the text we have so far
                        // 自定义stopToken（如果是上下文续杯的话）
                        if (
                            request.sydney
                            && (
                                stopTokenFound
                                || event.item.messages[0].topicChangerText
                                || event.item.messages[0].offense === 'OffenseTrigger'
                            )
                        ) {
                            if (!replySoFar) {
                                replySoFar = '[Error: The moderation filter triggered. Try again with different wording.]';
                            }
                            eventMessage.adaptiveCards[0].body[0].text = replySoFar;
                            eventMessage.text = replySoFar;
                            // delete useless suggestions from moderation filter
                            delete eventMessage.suggestedResponses;
                        }
                        resolve({
                            reply: eventMessage,
                            conversationExpiryTime: event?.item?.conversationExpiryTime,
                            response: event
                        });
                        return;
                    }
                    case 7: {
                        // [{"type":7,"error":"Connection closed with an error.","allowReconnect":true}]
                        clearTimeout(messageTimeout);
                        this.cleanupWebSocketConnection();
                        reject(new Error(event.error || 'Connection closed with an error.'));
                        return;
                    }
                    default:
                        return;
                }
            });
        });

        // set request conversation
        request.bingConversation.conversationId = conversationId
        request.bingConversation.conversationSignature = conversationSignature
        request.bingConversation.clientId = clientId


        const messageJson = JSON.stringify(this.buildWebSocketRequestData(request));

        logger.debug(messageJson);

        ws.send(`${messageJson}`);

        const rawResponse = await messagePromise;

        //中断输出
        this.cleanupWebSocketConnection()

        if (rawResponse instanceof Error) {
            logger.debug(`error: ${rawResponse.message}`);
            return rawResponse
        }

        logger.debug(`response: ${JSON.stringify(rawResponse)}`);

        const { reply, conversationExpiryTime, response } = rawResponse;

        return {
            conversation: {
                conversationId: conversationId,
                expiryTime: conversationExpiryTime,
                invocationId: invocationId + 1,
                clientId: clientId,
                conversationSignature: conversationSignature,
            },
            message: reply,
            respose: response
        }
    }
}
