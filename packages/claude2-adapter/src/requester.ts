import { ModelRequestParams, ModelRequester } from '@dingyi222666/koishi-plugin-chathub/lib/llm-core/platform/api';
import { ClientConfig } from '@dingyi222666/koishi-plugin-chathub/lib/llm-core/platform/config';
import { WebSocket } from 'ws'
import { AIMessageChunk, BaseMessage, ChatGeneration, ChatGenerationChunk } from 'langchain/schema';
import { createLogger } from '@dingyi222666/koishi-plugin-chathub/lib/utils/logger';
import { request } from "@dingyi222666/koishi-plugin-chathub/lib/utils/request"
import { ChatHubError, ChatHubErrorCode } from '@dingyi222666/koishi-plugin-chathub/lib/utils/error';
import { readableStreamToAsyncIterable } from '@dingyi222666/koishi-plugin-chathub/lib/utils/stream';
import { sseIterable } from '@dingyi222666/koishi-plugin-chathub/lib/utils/sse'
import { Context, Random, sleep } from 'koishi';
import { randomUUID } from 'crypto';
import os from "os"
import fs from "fs/promises"
import path from 'path';
import { v4 as uuid } from 'uuid'
import { HEADERS, formatMessages } from './utils';
import { Claude2ClientConfig, ClaudeChatResponse, ClaudeCreateConversationResponse, ClaudeOrganizationResponse, ClaudeSendMessageRequest } from './types';

const logger = createLogger()
const STOP_TOKEN = ["\n\nuser:", "\n\nsystem:"]


export class Claude2Requester extends ModelRequester {

    private _ua = request.randomUA()

    private _headers: typeof HEADERS & Record<string, string> = { ...HEADERS }

    private _conversationId: string

    constructor(private ctx: Context, private _config: Claude2ClientConfig, private _organizationId?: string) {
        super()

        let cookie = _config.apiKey

        if (!cookie.includes("sessionKey=")) {
            cookie = 'sessionKey=' + cookie
        }

        this._headers.cookie = cookie
        //   this._headers['User-Agent'] = this._ua
    }

    async *completionStream(params: ModelRequestParams): AsyncGenerator<ChatGenerationChunk> {
        if (this._organizationId == null || this._conversationId == null) {
            await this.init(params.id)
        }

        const prompt = this._config.formatMessages ? params.input[params.input.length - 1].content : await formatMessages(params.input)


        try {
            const iterator = this._sendMessage(prompt, params)

            for await (const response of iterator) {
                yield response
            }

        } catch (e) {

            try {
                await this.dispose(params.id)
            } catch (e) {
                logger.error(e)
            }

            if (e instanceof ChatHubError) {
                throw e
            }

            throw new ChatHubError(ChatHubErrorCode.API_REQUEST_FAILED, e)
        }

        return
    }

    async *_sendMessage(prompt: string, params: ModelRequestParams): AsyncGenerator<ChatGenerationChunk> {
        const headers = {
            ...this._headers
        }

        const stopTokens = STOP_TOKEN.concat(params.stop ?? [])

        headers.Accept = 'text/event-stream'
        headers.Referer = `https://claude.ai/chats/${this._conversationId}`
        headers["Upgrade-Insecure-Requests"] = "1"

        const requestBody: ClaudeSendMessageRequest = {
            completion: {
                prompt,
                timezone: "Asia/Shanghai",
                model: "claude-2",
                incremental: true,
            },
            organization_uuid: this._organizationId,
            conversation_uuid: this._conversationId,
            text: prompt,
            attachments: []
        }

        const controller = new AbortController();

        if (params.signal) {
            params.signal.addEventListener('abort', () => {
                controller.abort()
            })
        }

        const url = this._concatUrl(`api/append_message`)

        const response = await request.fetch(
            url, {
            headers,
            signal: controller.signal,
            method: 'POST',
            // credentials: "same-origin",
            body: JSON.stringify(requestBody),
         
        })

        let result = ''
        let stopTokenFound = false

        const iterator = sseIterable(response)

        for await (const chunk of iterator) {
            if (chunk === "[DONE]") {
                return
            }

            try {
                result += (JSON.parse(chunk) as ClaudeChatResponse).completion
            } catch (e) {
                let errorString = `Claude2 SSE Parse Error: ${chunk} `

                logger.error(errorString)

                if (chunk.includes('div')) {
                    errorString = 'Claude2 出现了一些问题！可能是被 Claude 官方检测了。请尝试重启 koishi 或更换 Cookie 或者等待一段时间再试。'

                    throw new ChatHubError(ChatHubErrorCode.API_REQUEST_RESOLVE_CAPTCHA, new Error(errorString))
                }

                continue
            }

            let text = result

            stopTokens.forEach(token => {
                if (result != null && result.includes(token)) {
                    const startIndex = result.indexOf(token)
                    text = result.substring(0, startIndex)
                        .replace(token, '')

                    text = result

                    stopTokenFound = true

                    controller.abort()
                }
            })

            if (!stopTokenFound && text != null) {
                result = text
            }


            yield new ChatGenerationChunk({
                text: result,
                message: new AIMessageChunk(result)
            })
        }
    }

    async init(id?: string): Promise<void> {
        for (let count = 0; count < this._config.maxRetries; count++) {
            try {
                await this._init(id)
                break
            } catch (e) {
                logger.error(e)
                if (e.cause) {
                    logger.error(e.cause)
                }
                await sleep(10000)

                if (count == this._config.maxRetries - 1) {
                    throw e
                }
            }
        }
    }


    get organizationId() {
        return this._organizationId
    }


    async dispose(id?: string): Promise<void> {
        await this._deleteConversation(this._conversationId, id)

        this._conversationId = null
        this._organizationId = null
    }


    private async _init(id?: string): Promise<void> {
        if (this._organizationId == null) {
            this._organizationId = await this._getOrganizationId()
        }

        if (id == null) {
            return
        }

        if (this._conversationId == null) {
            const conversationId = await this.ctx.chathub.cache.get(`claude2-${id}`)

            this._conversationId = conversationId
        }

        if (this._conversationId == null) {
            this._conversationId = await this._createConversation(uuid())
        }


        await this.ctx.chathub.cache.set(`claude2-${id}`, this._conversationId)
    }

    private async _deleteConversation(conversationId: string, id?: string): Promise<void> {
        const headers = {
            ...this._headers
        }

        // headers.Accept = 'text/event-stream, text/event-stream'
        // headers.Referer = `https://claude.ai/chats`//${conversationId}`

        const controller = new AbortController();

        const url = this._concatUrl(`organizations/${this._organizationId}/chat_conversations/${conversationId}`)

        logger.debug(`Claude2 deleteConversation: ${url}`)

        const response = await request.fetch(
            url, {
            headers,
            signal: controller.signal,
            method: 'delete',
            body: JSON.stringify(conversationId)
        })


        try {
            await this.ctx.chathub.cache.delete(`claude2-${id ?? conversationId}`)

            logger.debug(`Claude2 deleteConversation: ${response.status}`)

        } catch (e) {
            throw new ChatHubError(ChatHubErrorCode.MODEL_DEPOSE_ERROR, e)
        }

    }


    private async _createConversation(conversationId: string) {

        if (this._organizationId == null) {
            await this.init()
        }

        const url = this._concatUrl(`api/organizations/${this._organizationId}/chat_conversations`)


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

        logger.debug(`Claude2 createConversation: ${raw}`)

        try {
            const data = JSON.parse(raw) as ClaudeCreateConversationResponse

            if (data?.uuid !== conversationId) {
                throw new ChatHubError(ChatHubErrorCode.MODEL_DEPOSE_ERROR, new Error('Invalid response from Claude'))
            }

            return conversationId
        } catch (e) {
            throw new ChatHubError(ChatHubErrorCode.MODEL_INIT_ERROR, e)
        }
    }


    private async _getOrganizationId() {
        const url = this._concatUrl('api/organizations')

        const headers = {
            ...this._headers
        }

        // headers.Origin = undefined

        const result = await request.fetch(
            url,
            {
                headers: headers
            },
        )

        const raw = await result.text()

        logger.debug(`Claude2 getOrganizationId: ${raw}`)

        try {
            const array = JSON.parse(raw) as ClaudeOrganizationResponse[]
            const data = array?.[0]

            if (!data?.uuid) {
                throw new ChatHubError(ChatHubErrorCode.MODEL_INIT_ERROR, new Error('Can\'t find organization id: ' + raw))
            }

            return data.uuid
        } catch (e) {
            throw new ChatHubError(ChatHubErrorCode.MODEL_INIT_ERROR, e)
        }

        fetch("https://claude.ai/api/append_message", {
            "headers": {
                "accept": "text/event-stream, text/event-stream",
                "accept-language": "zh-CN,zh;q=0.9,en;q=0.8,en-GB;q=0.7,en-US;q=0.6",
                "baggage": "sentry-environment=production,sentry-release=0455d12fbd3ce74d905d59a49a7813f1b0c3ff00,sentry-public_key=58e9b9d0fc244061a1b54fe288b0e483,sentry-trace_id=1422a9fd732d43d389a4816032d1391d",
                "content-type": "application/json",
                "sec-ch-ua": "\"Chromium\";v=\"118\", \"Microsoft Edge\";v=\"118\", \"Not=A?Brand\";v=\"99\"",
                "sec-ch-ua-mobile": "?0",
                "sec-ch-ua-platform": "\"Windows\"",
                "sec-fetch-dest": "empty",
                "sec-fetch-mode": "cors",
                "sec-fetch-site": "same-origin",
                "sentry-trace": "1422a9fd732d43d389a4816032d1391d-a948a82cebb2f706-0"
            },
            "referrer": "https://claude.ai/chat/c19f785e-f3f3-43e4-b0f6-342197884f8b",
            "referrerPolicy": "strict-origin-when-cross-origin",
            "body": "{\"completion\":{\"prompt\":\"。\",\"timezone\":\"Asia/Hong_Kong\",\"model\":\"claude-2\"},\"organization_uuid\":\"764a6aae-7639-4bb1-8e3d-08f6b42110ab\",\"conversation_uuid\":\"c19f785e-f3f3-43e4-b0f6-342197884f8b\",\"text\":\"。\",\"attachments\":[]}",
            "method": "POST",
            "mode": "cors",
            "credentials": "include"
        });

    }



    private _concatUrl(url: string): string {
        return 'https://claude.ai/' + url
    }
}

