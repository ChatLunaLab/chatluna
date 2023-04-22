import { Context } from 'koishi'

import { request, createLogger } from '@dingyi222666/koishi-plugin-chathub'
import PoeAdapter from './index'
import graphqlModel from './graphql';
import { PoeBot, PoeQueryChatIdResponse, PoeRequestHeaders, PoeRequestInit, PoeSettingsResponse } from './types'
import md5 from 'md5'
import WebSocket from 'ws';
import randomUserAgent from "random-useragent"
import { writeFileSync } from 'fs';

const logger = createLogger('@dingyi222666/chathub-poe-adapter/api')

export class Api {


    private settings: PoeSettingsResponse | null = null

    private poeRequestInit: PoeRequestInit

    private bots: Record<string, PoeBot> = {}

    private headers: PoeRequestHeaders | any = {
        "content-type": "application/json",
        Host: 'poe.com',
        Origin: "https://poe.com",
        Referrer: "https://poe.com/",
        "Sec-Fetch-Dest": "empty",
        "Sec-Fetch-Mode": "cors",
        "Sec-Fetch-Site": "same-origin",
        Connection: 'keep-alive',
        "User-Agent": randomUserAgent.getRandom(),
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7",
        "Accept-Encoding": "gzip, deflate, br",
        "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8,en-GB;q=0.7,en-US;q=0.6",
        "Dnt": "1",
        "Sec-Ch-Ua": "\"Not.A/Brand\";v=\"8\", \"Chromium\";v=\"114\", \"Microsoft Edge\";v=\"114\"",
        "Sec-Ch-Ua-Mobile": "?0",
        "Sec-Ch-Ua-Platform": "\"Windows\"",
        "Upgrade-Insecure-Requests": "1"

    }


    constructor(
        private readonly config: PoeAdapter.Config,
        private readonly ctx: Context
    ) {
        this.headers.Cookie = "p-b=" + config.pbcookie
        this.poeRequestInit = {
            modelName: config.model
        }
    }

    async makeRequest(requestBody: any) {
        requestBody = JSON.stringify(requestBody)

        this.headers['poe-tag-id'] = md5(requestBody + this.headers['poe-formkey'] + 'WpuLMiXEKKE98j56k')

        const response = await request.fetch('https://poe.com/api/gql_POST', {
            method: 'POST',
            headers: this.headers,
            body: requestBody
        })
        return await response.json()
    }


    private calculateClientNonce(size: number) {
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

    async sendMessage(query: string) {
        try {
            const result = await this.makeRequest({
                query: graphqlModel.sendMessageMutation,
                queryName: "chatHelpers_sendMessageMutation_Mutation",
                variables: {
                    bot: this.bots[this.poeRequestInit.modelName].botNickName,
                    chatId: this.bots[this.poeRequestInit.modelName].chatId,
                    query: query,
                    source: null,
                    withChatBreak: false,
                    clientNonce: this.calculateClientNonce(16)
                },
            }) as any

            logger.debug(`Send Message: ${JSON.stringify(result)}`)

            if (result.success == false) {
                throw new Error(result.message)
            }

            return result
        } catch (e) {
        }
    }

    async request(prompt: string): Promise<string | Error> {
        if (!this.settings || !this.headers['poe-formkey']) {
            await this.getCredentials()
        }

        const ws = await this.connectToWebSocket()
        await this.subscribe()

        const listenerPromise = this.buildListenerPromise(ws)

        this.sendMessage(prompt)

        const result = await listenerPromise

        await this.closeWebSocketConnection(ws)

        //  return Error('Not Implemented')
        return result
    }

    private async buildListenerPromise(ws: WebSocket): Promise<string | Error> {
        return new Promise((resolve, reject) => {
            let complete = false
            ws.onmessage = (e) => {
                const jsonData = JSON.parse(e.data.toString())
                writeFileSync('poe.json', JSON.stringify(jsonData))
                // logger.debug(`WebSocket Message: ${e.data.toString()}`)
                if (!jsonData.messages || jsonData.messages.length < 1) {
                    return
                }
                const messages = JSON.parse(jsonData.messages[0])

                const dataPayload = messages.payload.data
                logger.debug(`WebSocket Data Payload: ${JSON.stringify(dataPayload)}`)
                if (dataPayload.messageAdded === null) {
                    reject(new Error('Message Added is null'))
                }
                const text = dataPayload.messageAdded.text
                const state = dataPayload.messageAdded.state
                if (dataPayload.messageAdded.author !== 'human' && state === 'complete') {
                    if (!complete) {
                        complete = true
                        return resolve(text)
                    }
                }
            }

        })
    }

    private async connectToWebSocket(): Promise<WebSocket> {
        const url = this.getWebSocketUrl()
        logger.debug(`WebSocket URL: ${url}`)
        const ws = request.ws(url)
        return new Promise((resolve) => {
            ws.onopen = () => {
                logger.debug('WebSocket Connected')
                return resolve(ws)
            }
        })
    }

    private getWebSocketUrl() {
        const tchRand = Math.floor(Math.random() * 1000000) + 1
        // They're surely using 6 digit random number for ws url.
        const socketUrl = `wss://tch${tchRand}.tch.${this.settings.tchannelData.baseHost}`
        const boxName = this.settings.tchannelData.boxName
        const minSeq = this.settings.tchannelData.minSeq
        const channel = this.settings.tchannelData.channel
        const hash = this.settings.tchannelData.channelHash
        return `${socketUrl}/up/${boxName}/updates?min_seq=${minSeq}&channel=${channel}&hash=${hash}`
    }

    private async getCredentials() {
        this.settings = await (
            await request.fetch('https://poe.com/api/settings', { headers: this.headers })
        ).json() as PoeSettingsResponse

        logger.debug('poe settings', JSON.stringify(this.settings))

        if (this.settings.tchannelData.channel) {
            this.headers['poe-tchannel'] = this.settings.tchannelData.channel
        }

        await this.initBot()

    }


    private async getBotInfo(buildId: string, requestBotName: string): Promise<PoeBot> {

        const url = `https://poe.com/_next/data/${buildId}/${requestBotName}.json`

        const chatData = await (await request.fetch(url, { headers: this.headers })).json()

        const payload = chatData["pageProps"]["payload"]
        const chatOfBotDisplayName = payload["chatOfBotDisplayName"]

        return {
            botId: payload["id"],
            botNickName: chatOfBotDisplayName["defaultBotObject"]["nickname"],
            chatId: chatOfBotDisplayName["chatId"],
        }

    }

    private async initBot() {
        const source = (await (await request.fetch('https://poe.com', { headers: this.headers })).text())

        const jsonRegex = /<script id="__NEXT_DATA__" type="application\/json">(.+?)<\/script>/;

        const jsonText = source.match(jsonRegex)[1];

        const nextData = JSON.parse(jsonText);

        const buildId = nextData.buildId

        this.poeRequestInit.chatId = extractChatId(nextData, this.poeRequestInit.modelName)

        const formKey = extractFormkey(source)

        this.headers['poe-formkey'] = formKey
        logger.debug('poe formkey', this.headers['poe-formkey'])

        this.bots[this.poeRequestInit.modelName] = await this.getBotInfo(buildId, this.poeRequestInit.modelName)

        logger.debug('poe bot', JSON.stringify(this.bots))
    }

    private async subscribe() {
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

        const response = await this.makeRequest(query);

        logger.debug(`subscribe response: ${JSON.stringify(response)}`)
    }

    private async closeWebSocketConnection(ws: WebSocket): Promise<boolean> {
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
        this.settings = null
        this.headers['poe-formkey'] = null
    }

    async clearContext() {
        try {
            const result = await this.makeRequest({
                query: graphqlModel.addMessageBreakMutation,
                queryName: "AddMessageBreakMutation",
                variables: { chatId: this.poeRequestInit.chatId },
            })

            logger.debug('clear context', JSON.stringify(result))


            return true
        } catch (e) {
            logger.error(e)
            return false
        }
    }
}

function extractChatId(nextData: any, botName: string) {
    const viewer = nextData.props.pageProps.payload.viewer
    logger.debug('viewer data', JSON.stringify(viewer))

    const availableBots = viewer.availableBots

    if (availableBots == null) {
        throw new Error('No available bots, check your cookie')
    }

    const bot = availableBots.find((bot) => bot.displayName === botName);

    return bot.id as string
}

function extractFormkey(source: string) {
    const scriptRegex = /<script>if\(.+\)throw new Error;(.+)<\/script>/;
    const scriptText = source.match(scriptRegex)[1];
    const keyRegex = /var .="([0-9a-f]+)"/;
    const keyText = scriptText.match(keyRegex)[1];
    const cipherRegex = /\[(\d+)\]=.\[(\d+)\]/g
    const cipherPairs = scriptText.matchAll(cipherRegex);

    const formkeyList = Array.from(cipherPairs)
    const result = new Array<string>(formkeyList.length)
    formkeyList.forEach(([, k, v]) => {
        result[k] = keyText[v]
    })

    return result.join("")

}

