import { Conversation, SimpleMessage, createLogger } from '@dingyi222666/koishi-plugin-chathub';
import NewBingAdapter from './index';
import { Context, Quester } from 'koishi';
import { WebSocket } from "ws"
import { ConversationResponse } from './types';



const logger = createLogger('@dingyi222666/chathub-newbing-adapter/client')

/**
 * https://stackoverflow.com/a/58326357
 * @param {number} size
 */
const genRanHex = (size) => [...Array(size)].map(() => Math.floor(Math.random() * 16).toString(16)).join('')


/**
 * https://github.com/waylaidwanderer/node-chatgpt-api/blob/main/src/BingAIClient.js
 */
export class NewBingClient {

    private bingPingInterval: NodeJS.Timer;
    private host: string
    private webSocketHost: string
    private cookie: string

    constructor(
        public config: NewBingAdapter.Config,
        public ctx: Context
    ) {
        this.host = config.bingHost
        this.webSocketHost = config.bingWebSocketHost
        this.cookie = config.cookie
    }

    private buildHeaders() {
        return {
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
                'x-ms-client-request-id': crypto.randomUUID(),
                'x-ms-useragent': 'azsdk-js-api-client-factory/1.0.0-beta.1 core-rest-pipeline/1.10.0 OS/Win32',
                cookie: this.cookie,
                Referer: 'https://www.bing.com/search?q=Bing+AI&showconv=1&FORM=hpcodx',
                'Referrer-Policy': 'origin-when-cross-origin',
                // Workaround for request being blocked due to geolocation
                'x-forwarded-for': '1.1.1.1',
            },
        };
    }


    async createWebSocketConnection(): Promise<WebSocket | Error> {
        return new Promise((resolve, reject) => {
            let host = 'wss://sydney.bing.com'


            if (this.host) {
                host = this.webSocketHost.replace(/https?:\/\//, 'wss://')
            }

            const ws = this.ctx.http.ws(`${host}/sydney/ChatHub`)

            ws.on('error', err => reject(err));

            ws.on('open', () => {
                logger.debug('performing handshake');

                ws.send('{"protocol":"json","version":1}');
            });

            ws.on('close', () => {
                logger.debug('disconnected');
            });

            ws.on('message', (data) => {
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
                    logger.debug('handshake established');
                    // ping

                    this.bingPingInterval = setInterval(() => {
                        ws.send('{"type":6}');
                        // same message is sent back on/after 2nd time as a pong
                    }, 15 * 1000);
                    resolve(ws);
                    return;
                }

                logger.debug(`received message from bing: ${JSON.stringify(messages)}`);
            });
        });
    }


    async cleanupWebSocketConnection(ws: WebSocket) {
        clearInterval(this.bingPingInterval)
        ws.close()
        ws.removeAllListeners()
    }

    private async createNewConversation(): Promise<ConversationResponse> {
        const response = await this.ctx.http.get<Quester.AxiosResponse>(`${this.host}/turing/conversation/create`, this.buildHeaders());

        const { status, headers } = response;

        if (status === 200 && +headers['content-length'] < 5) {
            throw new Error('/turing/conversation/create: Your IP is blocked by BingAI.');
        }

        const body = response.data
        try {
            return JSON.parse(body);
        } catch (err) {
            throw new Error(`/turing/conversation/create: failed to parse response body.\n${body}`);
        }
    }

    ask(conversation: Conversation, message: SimpleMessage): Promise<SimpleMessage> {


    }
}