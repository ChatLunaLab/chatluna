import { Context, sleep } from 'koishi'

import { request } from "@dingyi222666/koishi-plugin-chathub/lib/llm-core/utils/request"
import { createLogger } from '@dingyi222666/koishi-plugin-chathub/lib/llm-core/utils/logger'

import md5 from 'md5'
import WebSocket from 'ws';
import randomUserAgent from "random-useragent"

import { ClaudeChatResponse, ClaudeCreateConversationResponse, ClaudeOrganizationResponse, ClaudeSendMessageRequest } from './types';
import Claude2ChatPlugin from '.';

const logger = createLogger('@dingyi222666/chathub-claude2-adapter/api')

const STOP_TOKEN = ["\n\nuser:", "\n\nsystem:"]

export class Api {


    private _organizationId: string

    private _ua = randomUserAgent.getRandom()

    private _headers: any = {
        "content-type": "application/json",
        Host: 'claude.ai',
        Origin: "https://claude.aim",
        Referrer: "?",
        "Sec-Fetch-Dest": "empty",
        "Sec-Fetch-Mode": "cors",
        "Sec-Fetch-Site": "same-origin",
        Referer: 'https://claude.ai/chats',
        Connection: 'keep-alive',
        "User-Agent": this._ua,
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
        private readonly config: Claude2ChatPlugin.Config,
    ) {
        this._headers.cookie = config.cookie

    }

    private _concatUrl(url: string): string {
        return 'https://claude.ai/' + url
    }


    async sendMessage(conversationId: string, message: string): Promise<string> {

        if (this._organizationId == null) {
            await this.init()
        }

        const headers = {
            ...this._headers
        }

        headers.Referer = `https://claude.ai/chat/${conversationId}`


        const requestBody: ClaudeSendMessageRequest = {
            completion: {
                prompt: message,
                timezone: "Asia/Hong_Kong",
                model: "claude-2"
            },
            organization_uuid: this._organizationId,
            conversation_uuid: conversationId,
            text: message,
            attachments: []
        }

        const url = this._concatUrl(`/api/append_message`)

        const response = await request.fetch(
            url, {
            headers,
            method: 'POST',
            body: JSON.stringify(requestBody)
        })

        const reader = response.body.getReader();

        let result = ''
        let stopTokenFound = false

        const decoder = new TextDecoder()

        while (true) {

            const { value, done } = await reader.read();

            const decodeValue = decoder.decode(value)

            let text = (JSON.parse(decodeValue) as ClaudeChatResponse).completion

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

            if (done) {
                logger.debug(`Claude2 Response: ${result}`)
                break; // 读取完毕
            }

        }


        return result
    }

    async createConversation(conversationId: string) {

        if (this._organizationId == null) {
            await this.init()
        }

        const url = this._concatUrl(`/api/organizations/${this._organizationId}/chat_conversations`)

        const result = await request.fetch(
            url,
            {
                headers: this._headers,
                method: 'POST',
                body: JSON.stringify({
                    uuid: conversationId,
                    name: ""
                })
            })

        const raw = await result.text()

        try {
            const data = JSON.parse(raw) as ClaudeCreateConversationResponse

            if (data?.uuid !== conversationId) {
                return Error('Can\'t find create conversation: ' + raw)
            }

            return true
        } catch (e) {
            return Error('Can\'t parse create conversation: ' + raw)
        }
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



    async getOrganizationsId() {
        const url = this._concatUrl('api/organizations')


        const result = await request.fetch(
            url,
            {
                headers: this._headers,
            }
        )

        const raw = await result.text()

        try {
            const array = JSON.parse(raw) as ClaudeOrganizationResponse[]
            const data = array?.[0]

            if (!data?.uuid) {
                throw new Error('Can\'t find organization id: ' + raw)
            }

            return data.uuid
        } catch (e) {
            throw new Error('Can\'t parse organization id: ' + raw)
        }

    }

    async init() {
        for (let count = 0; count < this.config.maxRetries; count++) {
            try {
                this._organizationId = await this.getOrganizationsId()
                break
            } catch (e) {
                logger.error(e)
                if (e.stack) {
                    logger.error(e.stack)
                }
                await sleep(1000)

                if (count == this.config.maxRetries - 1) {
                    throw e
                }
            }
        }

    }


}


