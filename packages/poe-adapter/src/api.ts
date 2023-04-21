import { Context } from 'koishi'

import { request, createLogger } from '@dingyi222666/koishi-plugin-chathub'
import PoeAdapter from './index'
import graphqlModel from './graphql';
import { PoeBot, PoeQueryChatIdResponse, PoeRequestHeaders, PoeRequestInit, PoeSettingsResponse } from './types'
import md5 from 'md5'
import WebSocket from 'ws';
import { rejects } from 'assert';

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
        Connection: 'keep-alive',
        "User-Agent": "Mozilla/5.0 (X11; Linux x86_64; rv:102.0) Gecko/20100101 Firefox/102.0" //randomUseragent.getRandom()
    }


    constructor(
        private readonly config: PoeAdapter.Config,
        private readonly ctx: Context
    ) {
        //URLEncode
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

    async sendMessage(query: string) {
        try {
            const result = await this.makeRequest({
                query: graphqlModel.addHumanMessageMutation,
                variables: {
                    bot: this.bots[this.poeRequestInit.modelName].botId,
                    chatId: this.bots[this.poeRequestInit.modelName].chatId,
                    query: query,
                    source: null,
                    withChatBreak: false,
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

        return result
    }

    private async buildListenerPromise(ws: WebSocket): Promise<string | Error> {
        return new Promise((resolve,reject) => {
            let complete = false
            ws.onmessage = (e) => {
                const jsonData = JSON.parse(e.data.toString())
                logger.debug(`WebSocket Message: ${e.data.toString()}`)
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
        const ws = request.ws(url)
        return new Promise((resolve) => {
            ws.onopen = () => {
                logger.debug('WebSocket Connected')
                return resolve(ws)
            }
        })
    }

    private getWebSocketUrl() {
        const tchRand = Math.floor(100000 + Math.random() * 900000) // They're surely using 6 digit random number for ws url.
        const socketUrl = `wss://tch${tchRand}.tch.quora.com`
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

        const payload = chatData["pageProps"]["payload"]["chatOfBotDisplayName"]

        return {
            botId: payload["defaultBotObject"]["nickname"],
            chatId: payload["chatId"],
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
                        "query": graphqlModel.messageAddedSubscription
                    },
                    {
                        "subscriptionName": "viewerStateUpdated",
                        "query": graphqlModel.viewerStateUpdatedSubscription
                    }
                ]
            },
            query: graphqlModel.subscriptionsMutation
        };

        await this.makeRequest(query);
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
    const availableBots = nextData.props.pageProps.payload.viewer.availableBots

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

