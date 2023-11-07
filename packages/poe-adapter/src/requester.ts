import {
    ModelRequester,
    ModelRequestParams
} from 'koishi-plugin-chatluna/lib/llm-core/platform/api'
import { WebSocket } from 'ws'
import { AIMessageChunk, ChatGenerationChunk } from 'langchain/schema'
import {
    chathubFetch,
    randomUA,
    ws
} from 'koishi-plugin-chatluna/lib/utils/request'
import {
    ChatHubError,
    ChatHubErrorCode
} from 'koishi-plugin-chatluna/lib/utils/error'
import { withResolver } from 'koishi-plugin-chatluna/lib/utils/promise'
import { readableStreamToAsyncIterable } from 'koishi-plugin-chatluna/lib/utils/stream'
import { Context, sleep } from 'koishi'
import {
    PoeBot,
    PoeClientConfig,
    PoeRequestHeaders,
    PoeSettingsResponse
} from './types'
import {
    calculateClientNonce,
    extractFormKey,
    formatMessages,
    QueryHashes,
    queryOrCreateDeviceId,
    RequestBody
} from './utils'
import md5 from 'md5'
import { writeFileSync } from 'fs'
import { logger } from '.'

const STOP_TOKEN = ['\n\nuser:', '\n\nsystem:', 'user:', 'system:']

export class PoeRequester extends ModelRequester {
    //   private _cookie: string

    constructor(
        private ctx: Context,
        private _config: PoeClientConfig
    ) {
        super()

        if (_config.apiKey.includes('p-b=')) {
            this._headers.cookie = _config.apiKey
        } else {
            this._headers.cookie = 'p-b=' + _config.apiKey
        }
    }

    async *completionStream(
        params: ModelRequestParams
    ): AsyncGenerator<ChatGenerationChunk> {
        await this.init()

        // await this._refreshConversation()

        let err: Error | null
        const stream = new TransformStream()

        const iterable = readableStreamToAsyncIterable<string>(stream.readable)

        const writable = stream.writable.getWriter()

        setTimeout(async () => {
            const listenerPromise = this._buildListenerPromise(
                params,
                this._ws,
                writable
            )

            /* await */
            // not await to prevent blocking
            await this._sendMessage(params)

            const result = await listenerPromise

            if (result instanceof Error) {
                if (!(result instanceof ChatHubError)) {
                    err = new ChatHubError(
                        ChatHubErrorCode.API_REQUEST_FAILED,
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

            if (chunk === '[DONE]') {
                return
            }

            yield new ChatGenerationChunk({
                text: chunk,
                message: new AIMessageChunk(chunk)
            })
        }

        if (err) {
            await this.dispose()
            throw err
        }
    }

    async init(): Promise<void> {
        try {
            await this._runWithRetry(
                async () => {
                    await this._init()
                },
                this._config.maxRetries,
                sleep.bind(null, 3000)
            )
        } catch (e) {
            if (e instanceof ChatHubError) {
                throw e
            }
            throw new ChatHubError(
                ChatHubErrorCode.MODEL_CONVERSION_INIT_ERROR,
                e
            )
        }
    }

    async getModels() {
        await this.init()

        return Object.keys(this._poeBots)
    }

    private async _sendMessage(
        params: ModelRequestParams
    ): Promise<string | Error> {
        const bot = this._poeBots[params.model]

        const prompt = this._config.formatMessages
            ? formatMessages(params.input)
            : params.input[params.input.length - 1].content

        const result = (await this._makeRequest({
            queryName: 'sendMessageMutation',
            variables: {
                bot: bot.botNickName,
                chatId: bot.chatId,
                query: prompt,
                source: {
                    chatInputMetadata: {
                        useVoiceRecord: false
                    },
                    sourceType: 'chat_input'
                },
                shouldFetchChat: false,
                withChatBreak: false,
                sdid: this._poeSettings.sdid,
                attachments: [],
                clientNonce: calculateClientNonce(16)
            }
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
        })) as any

        logger.debug(`Send Message: ${JSON.stringify(result)}`)

        if (result.data == null) {
            throw new Error(result.errors[0]?.message ?? result)
        }

        bot.chatId = result.data.messageEdgeCreate.message.node.messageId

        return result
    }

    private async _init() {
        if (
            this._poeSettings == null ||
            this._headers['poe-formkey'] == null ||
            this._ws == null
        ) {
            await this._getCredentials()

            await this._initBots()

            await this._subscribe()

            this._ws = await this._connectToWebSocket()
        }
    }

    private async _initBots() {
        const cloneOfHeaders = { ...this._headers }
        cloneOfHeaders['content-type'] = 'text/html'

        const removeHeaders = {
            Host: 'poe.com',
            Origin: 'https://poe.com',
            Referrer: 'https://poe.com/',
            'Sec-Fetch-Dest': 'empty',
            'Sec-Fetch-Mode': 'cors',
            'Sec-Fetch-Site': 'same-origin'
        }

        for (const key in removeHeaders) {
            delete cloneOfHeaders[key]
        }

        const response = await chathubFetch('https://poe.com', {
            headers: cloneOfHeaders
        })

        const source = await response.text()

        const jsonRegex =
            /<script id="__NEXT_DATA__" type="application\/json">(.+?)<\/script>/

        const jsonText = source.match(jsonRegex)[1]

        const nextData = JSON.parse(jsonText)

        const scriptRegex =
            /src="(https:\/\/psc2.cf2.poecdn.net\/[a-f0-9]{40}\/_next\/static\/chunks\/pages\/_app-[a-f0-9]{16}.js)"/

        const scriptSrc = source.match(scriptRegex)[1]

        logger.debug(`poe script src ${scriptSrc}`)

        const saltSource = await (
            await chathubFetch(scriptSrc, { headers: cloneOfHeaders })
        ).text()

        const [formKey, formKeySalt] = extractFormKey(source, saltSource)

        this._formKeySalt = formKeySalt ?? this._formKeySalt

        this._headers['poe-formkey'] = formKey

        logger.debug(`poe formkey ${formKey}, salt ${formKeySalt}`)

        writeFileSync('data/chathub/temp/poe.json', JSON.stringify(nextData))

        const viewer =
            nextData?.['props']?.['initialData']?.['data']?.['pageQuery']?.[
                'viewer'
            ]

        if (viewer == null || !('availableBotsConnection' in viewer)) {
            throw new Error('Invalid cookie or no bots are available.')
        }

        const userId = viewer['poeUser']['id']
        const deviceId = await queryOrCreateDeviceId(this.ctx, userId)

        this._poeSettings.sdid = deviceId

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const botList: any[] = await this._getBotList()

        await Promise.all(
            botList.map(async (botRaw) =>
                this._runWithRetry(async () => {
                    const bot = await this._getBotInfo(botRaw.node.handle)

                    this._poeBots[bot.displayName] = bot
                }, this._config.maxRetries)
            )
        )

        logger.debug(`poe bot list ${JSON.stringify(this._poeBots)}`)
    }

    private async _getCredentials() {
        this._poeSettings = (await (
            await chathubFetch('https://poe.com/api/settings', {
                headers: this._headers
            })
        ).json()) as PoeSettingsResponse

        logger.debug('poe settings', JSON.stringify(this._poeSettings))

        if (this._poeSettings.tchannelData.channel) {
            this._headers['poe-tchannel'] =
                this._poeSettings.tchannelData.channel
        }
    }

    private async _getBotInfo(requestBotName: string): Promise<PoeBot> {
        const response = (await this._makeRequest({
            queryName: 'HandleBotLandingPageQuery',
            variables: {
                botHandle: requestBotName
            }
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
        })) as any

        const payload = response.data.bot

        return {
            botId: payload['id'],
            botNickName: payload['nickname'],
            chatId: undefined,
            displayName: requestBotName
        }
    }

    private async _getBotList() {
        let botListData = await this._makeRequest({
            queryName: 'BotSelectorModalQuery',
            variables: {}
        })

        botListData = botListData['data']['viewer']['availableBotsConnection']
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        let botList = botListData['edges'] as any[]
        let nextPage = botListData['pageInfo']['hasNextPage'] as boolean
        let endCursor = botListData['pageInfo']['endCursor'] as number

        while (nextPage) {
            botListData = (
                await this._makeRequest({
                    queryName: 'availableBotsSelectorModalPaginationQuery',
                    variables: {
                        cursor: endCursor,
                        limit: 10
                    }
                })
            )['data']['viewer']['availableBotsConnection']

            botList = botList.concat(botListData['edges'])
            nextPage = botListData['pageInfo']['hasNextPage']
            endCursor = botListData['pageInfo']['endCursor']

            await sleep(100)
        }

        return botList
    }

    private _connectToWebSocket(): Promise<WebSocket> {
        const url = this._getWebSocketUrl()
        logger.debug(`WebSocket URL: ${url}`)
        const socket = ws(url)
        return new Promise((resolve) => {
            socket.onopen = () => {
                logger.debug('WebSocket Connected')
                return resolve(socket)
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

    private async _buildListenerPromise(
        params: ModelRequestParams,
        ws: WebSocket,
        writable: WritableStreamDefaultWriter<string>
    ): Promise<string | Error> {
        const { promise, resolve, reject } = withResolver<string | Error>()

        let complete = false
        let result = ''
        let stopTokenFound = false
        const stopTokens = STOP_TOKEN.concat(params.stop ?? [])

        ws.onmessage = async (e) => {
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

            stopTokens.forEach((token) => {
                if (text.includes(token)) {
                    const startIndex = text.indexOf(token)
                    text = text.substring(0, startIndex).replace(token, '')

                    result = text

                    stopTokenFound = true
                }
            })

            if (!stopTokenFound) {
                result = text
                await writable.write(result)
            }

            if (
                dataPayload.messageAdded.author !== 'human' &&
                state === 'complete'
            ) {
                if (!complete) {
                    complete = true
                    logger.debug(
                        `WebSocket Data Payload: ${JSON.stringify(dataPayload)}`
                    )

                    await writable.write('[DONE]')
                    return resolve(result)
                }
            }
        }

        return promise
    }

    private async _subscribe() {
        const query: RequestBody = {
            queryName: 'subscriptionsMutation',
            variables: {
                subscriptions: [
                    {
                        subscriptionName: 'messageAdded',
                        queryHash: QueryHashes['messageAdded'],
                        query: null
                    },
                    {
                        subscriptionName: 'viewerStateUpdated',
                        queryHash: QueryHashes['viewerStateUpdated'],
                        query: null
                    }
                ]
            }
        }

        const response = await this._makeRequest(query)

        logger.debug(`subscribe response: ${JSON.stringify(response)}`)
    }

    private async _makeRequest(requestBody: RequestBody) {
        requestBody.extensions = {
            hash: QueryHashes[requestBody.queryName]
        }
        const encodedRequestBody = JSON.stringify(requestBody)
        this._headers['poe-tag-id'] = md5(
            encodedRequestBody +
                this._headers['poe-formkey'] +
                this._formKeySalt
        )

        const response = await chathubFetch('https://poe.com/api/gql_POST', {
            method: 'POST',
            headers: this._headers,
            body: encodedRequestBody
        })
        return await response.json()
    }

    private async _runWithRetry<T>(
        func: () => Promise<T>,
        retryCount = 0,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        failFunc?: (error: any) => Promise<void>
    ) {
        for (let count = 0; count < this._config.maxRetries; count++) {
            try {
                const result = await func()
                return result
            } catch (e) {
                if (failFunc) {
                    await failFunc(e)
                }
                logger.error(`poe.trade error`, e)
                if (count === retryCount - 1) {
                    throw e
                }
                // continue
            }
        }
    }

    // ?
    private async _clearContext(bot: PoeBot) {
        await this.init()

        try {
            const result = (await this._makeRequest({
                queryName: 'sendChatBreakMutation',
                variables: {
                    clientNotice: calculateClientNonce(16),
                    chatId: bot.chatId
                }
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
            })) as any

            logger.debug('clear context', JSON.stringify(result))

            if (result.data == null) {
                throw new Error('Clear context failed')
            }

            return true
        } catch (e) {
            await this._closeConnect()
            logger.error(e)
            return false
        }
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

    private async _closeConnect() {
        this._poeSettings = null
        this._headers['poe-formkey'] = null

        if (this._ws != null) {
            await this._closeWebSocketConnection()
        }
    }

    async dispose(): Promise<void> {
        for (const bot of Object.values(this._poeBots)) {
            await this._clearContext(bot)
            bot.chatId = undefined
        }

        await this._closeConnect()
    }

    private _poeSettings: PoeSettingsResponse | null = null

    private _poeBots: Record<string, PoeBot> = {}

    private _ws: WebSocket | null = null

    private _formKeySalt = '4LxgHM6KpFqokX0Ox'

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    private _headers: PoeRequestHeaders | any = {
        'content-type': 'application/json',
        Host: 'poe.com',
        Origin: 'https://poe.com',
        Referrer: 'https://poe.com/',
        'Sec-Fetch-Dest': 'empty',
        'Sec-Fetch-Mode': 'cors',
        'Sec-Fetch-Site': 'same-origin',
        Connection: 'keep-alive',
        'User-Agent': randomUA(),
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7',
        'Accept-Encoding': 'gzip, deflate, br',
        'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8,en-GB;q=0.7,en-US;q=0.6',
        Dnt: '1',
        'Sec-Ch-Ua':
            '"Not/A)Brand";v="99", "Google Chrome";v="115", "Chromium";v="115"',
        'Sec-Ch-Ua-Mobile': '?0',
        'Sec-Ch-Ua-Platform': '"Windows"',
        'Upgrade-Insecure-Requests': '1'
    }
}
