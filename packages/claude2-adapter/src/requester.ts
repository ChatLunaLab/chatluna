import {
    ModelRequester,
    ModelRequestParams
} from 'koishi-plugin-chatluna/lib/llm-core/platform/api'
import { AIMessageChunk, ChatGenerationChunk } from 'langchain/schema'
import { createLogger } from 'koishi-plugin-chatluna/lib/utils/logger'
import {
    chatLunaFetch,
    globalProxyAddress,
    randomUA
} from 'koishi-plugin-chatluna/lib/utils/request'
import {
    ChatLunaError,
    ChatLunaErrorCode
} from 'koishi-plugin-chatluna/lib/utils/error'
import { sseIterable } from 'koishi-plugin-chatluna/lib/utils/sse'
import { Context, Logger, sleep } from 'koishi'
import { v4 as uuid } from 'uuid'
import { formatMessages, HEADERS } from './utils'
import {
    Claude2ClientConfig,
    ClaudeChatResponse,
    ClaudeCreateConversationResponse,
    ClaudeOrganizationResponse,
    ClaudeSendMessageRequest
} from './types'
import initCycleTLS from 'cycletls'
import { Config } from '.'

let logger: Logger
const STOP_TOKEN = ['\n\nuser:', '\n\nsystem:']

export class Claude2Requester extends ModelRequester {
    private _ua = randomUA()

    private _headers: typeof HEADERS & Record<string, string> = { ...HEADERS }

    private _conversationId: string

    constructor(
        private ctx: Context,
        private _pluginConfig: Config,
        private _config: Claude2ClientConfig,
        private _organizationId?: string
    ) {
        super()
        logger = createLogger(ctx, 'chatluna-claude2-adapter')

        let cookie = _config.apiKey

        if (!cookie.includes('sessionKey=')) {
            cookie = 'sessionKey=' + cookie
        }

        this._headers.cookie = cookie
        //   this._headers['User-Agent'] = this._ua
    }

    async *completionStream(
        params: ModelRequestParams
    ): AsyncGenerator<ChatGenerationChunk> {
        if (this._organizationId == null || this._conversationId == null) {
            await this.init(params.id)
        }

        const prompt = this._config.formatMessages
            ? await formatMessages(params.input)
            : params.input[params.input.length - 1].content

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

            if (e instanceof ChatLunaError) {
                throw e
            }

            throw new ChatLunaError(ChatLunaErrorCode.API_REQUEST_FAILED, e)
        }
    }

    async *_sendMessage(
        prompt: string,
        params: ModelRequestParams
    ): AsyncGenerator<ChatGenerationChunk> {
        const headers = {
            ...this._headers
        }

        const stopTokens = STOP_TOKEN.concat(params.stop ?? [])

        headers.Accept = 'text/event-stream'
        headers.Referer = `https://claude.ai/chats/${this._conversationId}`
        headers['Upgrade-Insecure-Requests'] = '1'

        const requestBody: ClaudeSendMessageRequest = {
            completion: {
                prompt,
                timezone: 'Asia/Shanghai',
                model: 'claude-2',
                incremental: true
            },
            organization_uuid: this._organizationId,
            conversation_uuid: this._conversationId,
            text: prompt,
            attachments: []
        }

        const controller = new AbortController()

        if (params.signal) {
            params.signal.addEventListener('abort', () => {
                controller.abort()
            })
        }

        const url = this._concatUrl(`api/append_message`)

        const cycleTLS = await initCycleTLS()

        const response = await cycleTLS(
            url,
            {
                ja3: this._pluginConfig.JA3Fingerprint,
                userAgent: this._pluginConfig.userAgent,
                proxy: globalProxyAddress,
                headers,
                disableRedirect: true,
                timeout: params.timeout / 1000,
                body: JSON.stringify(requestBody)
            },
            'post'
        )

        let result = ''
        let stopTokenFound = false

        if (response.status !== 200) {
            throw new ChatLunaError(
                ChatLunaErrorCode.API_REQUEST_FAILED,
                new Error(`${response.status} ${response.body}`)
            )
        }

        const readableStream = new ReadableStream({
            start(controller) {
                // as string
                controller.enqueue(Buffer.from(response.body as string).buffer)
                controller.close()
            }
        })

        const iterator = sseIterable(readableStream.getReader())

        for await (const chunk of iterator) {
            if (chunk === '[DONE]') {
                return
            }

            try {
                result += (JSON.parse(chunk) as ClaudeChatResponse).completion
            } catch (e) {
                let errorString = `Claude2 SSE Parse Error: ${chunk} `

                logger.error(errorString)

                if (chunk.includes('div')) {
                    errorString =
                        'Claude2 出现了一些问题！可能是被 Claude 官方检测了。请尝试重启 Koishi 或更换 Cookie 或等待一段时间后再试。'

                    throw new ChatLunaError(
                        ChatLunaErrorCode.API_REQUEST_RESOLVE_CAPTCHA,
                        new Error(errorString)
                    )
                }

                continue
            }

            let text = result

            stopTokens.forEach((token) => {
                if (result != null && result.includes(token)) {
                    const startIndex = result.indexOf(token)
                    text = result.substring(0, startIndex).replace(token, '')

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

                if (count === this._config.maxRetries - 1) {
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
            const conversationId = await this.ctx.chatluna.cache.get(
                `claude2-${id}`
            )

            this._conversationId = conversationId
        }

        if (this._conversationId == null) {
            this._conversationId = await this._createConversation(uuid())
        }

        await this.ctx.chatluna.cache.set(`claude2-${id}`, this._conversationId)
    }

    private async _deleteConversation(
        conversationId: string,
        id?: string
    ): Promise<void> {
        const headers = {
            ...this._headers
        }

        // headers.Accept = 'text/event-stream, text/event-stream'
        // headers.Referer = `https://claude.ai/chats`//${conversationId}`

        const controller = new AbortController()

        const url = this._concatUrl(
            `organizations/${this._organizationId}/chat_conversations/${conversationId}`
        )

        logger.debug(`Claude2 deleteConversation: ${url}`)

        const response = await chatLunaFetch(url, {
            headers,
            signal: controller.signal,
            method: 'delete',
            body: JSON.stringify(conversationId)
        })

        try {
            await this.ctx.chatluna.cache.delete(
                `claude2-${id ?? conversationId}`
            )

            logger.debug(`Claude2 deleteConversation: ${response.status}`)
        } catch (e) {
            throw new ChatLunaError(ChatLunaErrorCode.MODEL_DEPOSE_ERROR, e)
        }
    }

    private async _createConversation(conversationId: string) {
        if (this._organizationId == null) {
            await this.init()
        }

        const url = this._concatUrl(
            `api/organizations/${this._organizationId}/chat_conversations`
        )

        const result = await chatLunaFetch(url, {
            headers: this._headers,
            method: 'POST',
            body: JSON.stringify({
                uuid: conversationId,
                name: ''
            })
        })

        const raw = await result.text()

        logger.debug(`Claude2 createConversation: ${raw}`)

        try {
            const data = JSON.parse(raw) as ClaudeCreateConversationResponse

            if (data?.uuid !== conversationId) {
                throw new ChatLunaError(
                    ChatLunaErrorCode.MODEL_DEPOSE_ERROR,
                    new Error('Invalid response from Claude')
                )
            }

            return conversationId
        } catch (e) {
            throw new ChatLunaError(ChatLunaErrorCode.MODEL_INIT_ERROR, e)
        }
    }

    private async _getOrganizationId() {
        const url = this._concatUrl('api/organizations')

        const headers = {
            ...this._headers
        }

        // headers.Origin = undefined

        const result = await chatLunaFetch(url, {
            headers
        })

        const raw = await result.text()

        logger.debug(`Claude2 getOrganizationId: ${raw}`)

        try {
            const array = JSON.parse(raw) as ClaudeOrganizationResponse[]
            const data = array?.[0]

            if (!data?.uuid) {
                throw new ChatLunaError(
                    ChatLunaErrorCode.MODEL_INIT_ERROR,
                    new Error("Can't find organization id: " + raw)
                )
            }

            return data.uuid
        } catch (e) {
            throw new ChatLunaError(ChatLunaErrorCode.MODEL_INIT_ERROR, e)
        }
    }

    private _concatUrl(url: string): string {
        return 'https://claude.ai/' + url
    }
}
