import { Context, sleep } from 'koishi'

import { request } from "@dingyi222666/koishi-plugin-chathub/lib/llm-core/utils/request"
import { createLogger } from '@dingyi222666/koishi-plugin-chathub/lib/llm-core/utils/logger'
import graphqlModel from './graphql';
import { PoeBot, PoeRequestHeaders, PoeSettingsResponse } from './types'
import md5 from 'md5'
import WebSocket from 'ws';
import randomUserAgent from "random-useragent"
import PoePlugin from '.';
import { v4 as uuidv4 } from 'uuid';
import { getKeysCache } from '@dingyi222666/koishi-plugin-chathub';
import { writeFileSync } from 'fs';
import { Script, createContext } from 'vm';

const logger = createLogger('@dingyi222666/chathub-poe-adapter/api')

const STOP_TOKEN = ["\n\nuser:", "\n\nsystem:"]

export class Api {

    private _poeSettings: PoeSettingsResponse | null = null

    private _poeBots: Record<string, PoeBot> = {}

    private _ws: WebSocket | null = null

    private _formKeySalt = "Jb1hi3fg1MxZpzYfy"

    private _lock: boolean = false

    private _headers: PoeRequestHeaders | any = {
        "content-type": "application/json",
        Host: 'poe.com',
        Origin: "https://poe.com",
        Referrer: "https://poe.com/",
        "Sec-Fetch-Dest": "empty",
        "Sec-Fetch-Mode": "cors",
        "Sec-Fetch-Site": "same-origin",
        Connection: 'keep-alive',
        "User-Agent": randomUserAgent.getRandom((ua: any) => ua.browserName === 'Chrome' && parseFloat(ua.browserVersion) >= 90),
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7",
        "Accept-Encoding": "gzip, deflate, br",
        "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8,en-GB;q=0.7,en-US;q=0.6",
        "Dnt": "1",
        "Sec-Ch-Ua": "\"Not/A)Brand\";v=\"99\", \"Google Chrome\";v=\"115\", \"Chromium\";v=\"115\"",
        "Sec-Ch-Ua-Mobile": "?0",
        "Sec-Ch-Ua-Platform": "\"Windows\"",
        "Upgrade-Insecure-Requests": "1"

    }

    constructor(
        private readonly config: PoePlugin.Config,
    ) {
        this._headers.cookie = "p-b=" + config.pbcookie
    }

    private async _makeRequest(requestBody: any) {
        requestBody = JSON.stringify(requestBody)

        this._headers['poe-tag-id'] = md5(requestBody + this._headers['poe-formkey'] + this._formKeySalt)

        const response = await request.fetch('https://poe.com/api/gql_POST', {
            method: 'POST',
            headers: this._headers,
            body: requestBody
        })
        return await response.json()
    }


    private _calculateClientNonce(size: number) {
        /* e=>{
            let a = ""
              , n = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789"
              , t = 0;
            for (; t < e; )
                a += n.charAt(Math.floor(Math.random() * n.length)),
                t += 1;
            return a
        } */
        let a = ""
        const n = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789"
        let t = 0;

        for (; t < size;) {
            a += n.charAt(Math.floor(Math.random() * n.length)),
                t += 1;
        }

        return a
    }

    async sendMessage(bot: string, query: string) {
        try {
            const result = await this._makeRequest({
                query: graphqlModel.sendMessageMutation,
                queryName: "chatHelpers_sendMessageMutation_Mutation",
                variables: {
                    bot: this._poeBots[bot].botNickName,
                    chatId: this._poeBots[bot].chatId,
                    query: query,
                    source: null,
                    withChatBreak: false,
                    sdid: this._poeSettings.sdid,
                    clientNonce: this._calculateClientNonce(16)
                },
            }) as any

            logger.debug(`Send Message: ${JSON.stringify(result)}`)

            if (result.success == false) {
                throw new Error(result.message)
            }

            return result
        } catch (e) {
            await this.closeConnect()
        }
    }

    request(bot: string, prompt: string): Promise<string | Error> {
        return new Promise(async (resolve, reject) => {
            const messageTimeout = setTimeout(async () => {
                //   await this._closeWebSocketConnection(ws)
                reject(Error('Timed out waiting for response. Try enabling debug mode to see more information.'));
            }, this.config.timeout ?? 120 * 1000);

            await this.init()

            const listenerPromise = this._buildListenerPromise(this._ws)

            this.sendMessage(bot, prompt)

            const result = await listenerPromise

            clearTimeout(messageTimeout)

            //  await this._closeWebSocketConnection(ws)

            //  return Error('Not Implemented')
            resolve(result)
        })
    }

    private async _buildListenerPromise(ws: WebSocket): Promise<string | Error> {
        return new Promise((resolve, reject) => {
            let complete = false
            let result = ''
            let stopTokenFound = false

            ws.onmessage = (e) => {
                const jsonData = JSON.parse(e.data.toString())
                /*  writeFileSync('poe.json', JSON.stringify(jsonData)) */
                // logger.debug(`WebSocket Message: ${e.data.toString()}`)
                if (!jsonData.messages || jsonData.messages.length < 1) {
                    return
                }
                const messages = JSON.parse(jsonData.messages[0])

                const dataPayload = messages.payload.data
                // logger.debug(`WebSocket Data Payload: ${JSON.stringify(messages)}`)
                if (dataPayload.messageAdded == null) {
                    reject(new Error('Message Added is null'))
                }
                let text = ''
                const state = dataPayload.messageAdded.state

                if (dataPayload.messageAdded.author !== 'human') {
                    text = dataPayload.messageAdded.text
                }

                STOP_TOKEN.forEach(token => {
                    if (text.includes(token)) {
                        const startIndex = text.indexOf(token)
                        text = text.substring(0, startIndex)
                            .replace(token, '')

                        result = text

                        stopTokenFound = true
                    }

                })

                if (!stopTokenFound) {
                    result = text
                }

                if (dataPayload.messageAdded.author !== 'human' && state === 'complete') {
                    if (!complete) {
                        complete = true
                        logger.debug(`WebSocket Data Payload: ${JSON.stringify(dataPayload)}`)
                        return resolve(result)
                    }
                }
            }

        })
    }

    private async _connectToWebSocket(): Promise<WebSocket> {
        const url = this._getWebSocketUrl()
        logger.debug(`WebSocket URL: ${url}`)
        const ws = request.ws(url)
        return new Promise((resolve) => {
            ws.onopen = () => {
                logger.debug('WebSocket Connected')
                return resolve(ws)
            }
        })
    }

    private _getWebSocketUrl() {
        const tchRand = Math.floor(Math.random() * 1000000) + 1
        // They're surely using 6 digit random number for ws url.
        const socketUrl = `wss://tch${tchRand}.tch.${this._poeSettings.tchannelData.baseHost}`
        const boxName = this._poeSettings.tchannelData.boxName
        const minSeq = this._poeSettings.tchannelData.minSeq
        const channel = this._poeSettings.tchannelData.channel
        const hash = this._poeSettings.tchannelData.channelHash
        return `${socketUrl}/up/${boxName}/updates?min_seq=${minSeq}&channel=${channel}&hash=${hash}`
    }

    // https://github.com/ading2210/poe-api/blob/b40ea0d0729b6a9ba101f191b34ffaba1449d34d/poe-api/src/poe.py#L75
    private async _queryOrCreateDeviceId(userId: string) {
        const cache = getKeysCache()

        let deviceId = await cache.get("poe_device_id_" + userId)

        if (deviceId != null) {
            return deviceId
        }

        deviceId = uuidv4()

        await cache.set("poe_device_id_" + userId, deviceId)

        return deviceId

    }

    private async _getCredentials() {
        this._poeSettings = await (
            await request.fetch('https://poe.com/api/settings', { headers: this._headers })
        ).json() as PoeSettingsResponse

        logger.debug('poe settings', JSON.stringify(this._poeSettings))

        if (this._poeSettings.tchannelData.channel) {
            this._headers['poe-tchannel'] = this._poeSettings.tchannelData.channel
        }

        await this._initBot()
    }

    async listBots() {
        for (let count = 0; count < this.config.maxRetries; count++) {
            try {
                await this.init()
                break
            } catch (e) {
                logger.error(e)

                if (e.cause) {
                    logger.error(e.cause)
                }

                await sleep(3000)

                if (count == this.config.maxRetries - 1) {
                    throw e
                }
            }
        }

        return Object.keys(this._poeBots)
    }

    async init() {
        await (new Promise(async (resolve) => {
            while (this._lock) {
                await sleep(100)
            }
            resolve(true)
        }))
        if (this._poeSettings == null || this._headers['poe-formkey'] == null || this._ws == null) {
            this._lock = true
            await this._getCredentials()

            await this._subscribe()

            this._ws = await this._connectToWebSocket()
            this._lock = false
        }

    }


    private async _getBotInfo(buildId: string, requestBotName: string): Promise<PoeBot> {

        const url = `https://poe.com/_next/data/${buildId}/${requestBotName}.json`

        const chatData = (await (await request.fetch(url, { headers: this._headers })).json()) as any

        writeFileSync('data/chathub/temp/chat_data.json', JSON.stringify(chatData))

        const payload = chatData?.pageProps?.data

        const chatOfBotDisplayName = payload?.chatOfBotHandle

        if (payload == null || chatOfBotDisplayName == null) {
            throw new Error('Failed to get bot info, please check your cookie.')
        }

        return {
            botId: payload["id"],
            botNickName: chatOfBotDisplayName["defaultBotObject"]["nickname"],
            chatId: chatOfBotDisplayName["chatId"],
            displayName: requestBotName,
        }

    }

    private async _initBot() {
        const cloneOfHeaders = { ...this._headers }
        cloneOfHeaders['content-type'] = 'text/html'

        const removeHeaders = {
            Host: 'poe.com',
            Origin: "https://poe.com",
            Referrer: "https://poe.com/",
            "Sec-Fetch-Dest": "empty",
            "Sec-Fetch-Mode": "cors",
            "Sec-Fetch-Site": "same-origin",
        }

        for (const key in removeHeaders) {
            delete cloneOfHeaders[key]
        }

        const response = await request.fetch('https://poe.com', { headers: cloneOfHeaders })

        const source = await response.text()

        const jsonRegex = /<script id="__NEXT_DATA__" type="application\/json">(.+?)<\/script>/;

        const jsonText = source.match(jsonRegex)[1];

        const nextData = JSON.parse(jsonText);

        const buildId = nextData.buildId

        const scriptRegex = new RegExp('src="(https://psc2\.cf2\.poecdn\.net/[a-f0-9]{40}/_next/static/chunks/pages/_app-[a-f0-9]{16}\.js)"')

        const scriptSrc = source.match(scriptRegex)[1]

        logger.debug(`poe script src ${scriptSrc}`)

        const saltSource = (await (await request.fetch(scriptSrc, { headers: cloneOfHeaders })).text())

        let [formKey, formKeySalt] = extractFormkey(source, saltSource)

        this._formKeySalt = formKeySalt ?? this._formKeySalt

        this._headers['poe-formkey'] = formKey

        logger.debug('poe formkey', this._headers['poe-formkey'])

        writeFileSync('data/chathub/temp/poe.json', JSON.stringify(nextData))

        const viewer = nextData?.["props"]?.["pageProps"]?.["data"]?.["viewer"] ?? nextData?.["props"]?.["pageProps"]?.["payload"]?.["viewer"]

        if (viewer == null || !("availableBotsConnection" in viewer)) {
            logger.debug(`poe response ${jsonText}`)
            throw new Error("Invalid cookie or no bots are available.")
        }

        const userId = viewer["poeUser"]["id"]
        const deviceId = await this._queryOrCreateDeviceId(userId)

        this._poeSettings.sdid = deviceId

        const botList: any[] = viewer["availableBotsConnection"]['edges']

        await Promise.all(botList.map(async (botRaw) => {
            const bot = await this._getBotInfo(buildId, botRaw.node.displayName)

            this._poeBots[bot.displayName] = bot
        }))

        logger.debug(`poe bot list ${JSON.stringify(this._poeBots)}`)

    }

    private async _subscribe() {
        const query = {
            queryName: 'subscriptionsMutation',
            variables: {
                "subscriptions": [
                    {
                        "subscriptionName": "messageAdded",
                        "query": graphqlModel.subscriptionsMessageAddedSubscription
                    },
                    {
                        "subscriptionName": "viewerStateUpdated",
                        "query": graphqlModel.subscriptionsViewerStateUpdatedSubscription
                    }
                ]
            },
            query: graphqlModel.subscriptionsMutation
        };

        const response = await this._makeRequest(query);

        logger.debug(`subscribe response: ${JSON.stringify(response)}`)
    }

    private async _closeWebSocketConnection(ws: WebSocket): Promise<boolean> {
        return new Promise((resolve, reject) => {
            ws.onclose = () => {
                resolve(true)
            }
            try {
                ws.close()
            } catch (e) {
                reject(e)
            }
        })
    }

    async closeConnect() {
        this._poeSettings = null
        this._headers['poe-formkey'] = null

        if (this._ws != null) {
            await this._closeWebSocketConnection(this._ws)
        }
    }

    async clearContext(botName: string) {
        await this.init()

        try {
            const result = await this._makeRequest({
                query: graphqlModel.addMessageBreakEdgeMutation,
                queryName: "chatHelpers_addMessageBreakEdgeMutation_Mutation",
                variables: {
                    connections: [
                        `client:${this._poeBots[botName].botId}:__ChatMessagesView_chat_messagesConnection_connection`
                    ],
                    chatId: this._poeBots[botName].chatId,
                },
            }) as any


            logger.debug('clear context', JSON.stringify(result))


            if (result.data == null) {
                throw new Error('Clear context failed')
            }


            return true
        } catch (e) {
            await this.closeConnect()
            logger.error(e)
            return false
        }
    }
}


// https://github.com/ading2210/poe-api/blob/0e09fcbb4c420713d7983840ddce3c154df97be9/src/poe/__init__.py#L203
function extractFormkey(html: string, app_script: string): [string, string | null] {
    let scriptRegex = /<script>(.+?)<\/script>/g;
    let varsRegex = /window\._([a-zA-Z0-9]{10})="([a-zA-Z0-9]{10})"/;
    let [key, value] = varsRegex.exec(app_script)!.slice(1);

    let scriptText = `
      let QuickJS = undefined, process = undefined;
      let window = {
        document: {a:1},
        navigator: {
          userAgent: "a"
        }
      };
    `;

    scriptText += `window._${key} = '${value}';`;

    scriptText += [...html.matchAll(scriptRegex)].map((match) => match[1]).join('\n');

    writeFileSync('data/chathub/temp/poe_html.html', html)

    let functionRegex = /(window\.[a-zA-Z0-9]{17})=function/;
    let functionText = functionRegex.exec(scriptText)[1];
    scriptText += `${functionText}();`;

    writeFileSync('data/chathub/temp/script_text.js', scriptText)


    let context = createContext();
    let script = new Script(scriptText);
    let formkey = script.runInContext(context);

    let salt: string | null = null;
    try {
        let saltFunctionRegex = /function (.)\(_0x[0-9a-f]{6},_0x[0-9a-f]{6},_0x[0-9a-f]{6}\)/;
        let saltFunction = saltFunctionRegex.exec(scriptText)![1];
        let saltScript = `${saltFunction}(a=>a, '', '');`;
        // 使用 nodejs vm 来执行 salt_script
        script = new Script(saltScript);
        salt = script.runInContext(context);
    } catch (e) {
        logger.warn("Failed to obtain poe-tag-id salt: " + e.toString());
    }

    logger.debug(`formkey: ${formkey}, salt: ${salt}`);

    return [formkey, salt];
}
