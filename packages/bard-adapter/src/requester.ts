import {
    ModelRequester,
    ModelRequestParams
} from '@dingyi222666/koishi-plugin-chathub/lib/llm-core/platform/api'
import { ClientConfig } from '@dingyi222666/koishi-plugin-chathub/lib/llm-core/platform/config'
import { AIMessageChunk, BaseMessage, ChatGeneration, ChatGenerationChunk } from 'langchain/schema'
import { createLogger } from '@dingyi222666/koishi-plugin-chathub/lib/utils/logger'
import { chathubFetch } from '@dingyi222666/koishi-plugin-chathub/lib/utils/request'
import { ChatHubError, ChatHubErrorCode } from '@dingyi222666/koishi-plugin-chathub/lib/utils/error'
import { Random } from 'koishi'
import { BardRequestInfo, BardResponse, BardWebRequestInfo } from './types'
import { SESSION_HEADERS } from './utils'
import { randomUUID } from 'crypto'
import os from 'os'
import fs from 'fs/promises'
import path from 'path'

const logger = createLogger()

export class BardRequester extends ModelRequester {
    private _bardRequestInfo: BardRequestInfo

    private _bardWebRequestInfo?: BardWebRequestInfo | null = null

    constructor(private _config: ClientConfig) {
        super()
    }

    async *completionStream(params: ModelRequestParams): AsyncGenerator<ChatGenerationChunk> {
        // the bard not support event stream, so just call completion

        const result = await this.completion(params)

        yield new ChatGenerationChunk({
            text: result.text,
            message: new AIMessageChunk({
                content: result.message.content,
                name: result.message.name,
                additional_kwargs: result.message.additional_kwargs
            }),
            generationInfo: result.generationInfo
        })
    }

    async completion(params: ModelRequestParams): Promise<ChatGeneration> {
        if (this._bardWebRequestInfo == null) {
            await this.init()
        }

        const currentInput = params.input[params.input.length - 1]

        if (currentInput._getType() !== 'human') {
            throw new ChatHubError(
                ChatHubErrorCode.API_REQUEST_FAILED,
                new Error('BardRequester only support human input')
            )
        }

        const text = await this._completion(params, currentInput)

        return {
            text,
            message: new AIMessageChunk({
                content: text
            })
        }
    }

    private async _completion(params: ModelRequestParams, input: BaseMessage) {
        const messageStruct = await this._createMessageStruct(input)

        const requestParams = new URLSearchParams({
            bl: this._bardWebRequestInfo.bl,
            _reqid: this._bardRequestInfo.requestId.toString(),
            rt: 'c',
            'f.sid': this._bardWebRequestInfo.sid,
            hl: 'en'
        })

        const data = new URLSearchParams({
            'f.req': JSON.stringify([null, JSON.stringify(messageStruct)]),
            at: this._bardWebRequestInfo.at
            // null ??
        })

        const url =
            'https://bard.google.com/_/BardChatUi/data/assistant.lamda.BardFrontendService/StreamGenerate?' +
            requestParams.toString()

        const response = await chathubFetch(url, {
            method: 'POST',
            // ?
            body: data.toString() + '&',
            headers: this._buildHeader(),
            signal: params.signal
        })

        const bardResponse = await this._parseResponse(await response.text())

        this._bardRequestInfo.requestId = this._bardRequestInfo.requestId + 100000

        this._bardRequestInfo.conversation = {
            c: bardResponse.conversationId,
            r: bardResponse.responseId,
            rc: bardResponse.choices[0].id
        }

        const results: string[] = [bardResponse.content]

        // 暂时丢弃choices
        if (bardResponse.images.length > 0) {
            results.push(...bardResponse.images)
        }

        return results.join('\n')
    }

    private async _createMessageStruct(input: BaseMessage) {
        return [
            // input
            [
                input.content,
                0,
                null,
                await this._uploadImage(input),
                null,
                null,
                this._bardRequestInfo.conversation.c === '' ? 1 : 0
            ],
            // languages
            ['en'],
            // conversation
            [
                this._bardRequestInfo.conversation.c,
                this._bardRequestInfo.conversation.r,
                this._bardRequestInfo.conversation.rc,
                null,
                null,
                []
            ],
            // Unknown random string value (1000 characters +)
            '',
            // Should be random uuidv4 (32 characters)
            Buffer.from(randomUUID()).toString('hex'),
            // null ?
            null,
            // Unknown
            [1],
            0,
            [],
            [],
            1,
            0
        ]
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    private async _uploadImage(input: BaseMessage): Promise<any[]> {
        const image = input.additional_kwargs?.['images']?.[0]

        if (!image) {
            return []
        }

        // data:image/
        const imageName = 'bard-ai.' + image.match(/data:image\/(\w+);base64,(.+)/)?.[1]

        logger.debug(`Uploading image ${imageName}`)

        const imageData = Buffer.from(image.replace(/^data:image\/\w+;base64,/, ''), 'base64')

        const size = imageData.byteLength.toString()
        const formBody = [
            `${encodeURIComponent('File name')}=${encodeURIComponent(imageName)}`
        ].join('')

        try {
            let response = await chathubFetch('https://content-push.googleapis.com/upload/', {
                method: 'POST',
                headers: {
                    'X-Goog-Upload-Command': 'start',
                    'X-Goog-Upload-Protocol': 'resumable',
                    'X-Goog-Upload-Header-Content-Length': size,
                    'X-Tenant-Id': 'bard-storage',
                    'Push-Id': 'feeds/mcudyrk2a4khkz'
                },
                body: formBody,
                credentials: 'include'
            })

            const uploadUrl = response.headers.get('X-Goog-Upload-URL')

            response = await chathubFetch(uploadUrl, {
                method: 'POST',
                headers: {
                    'X-Goog-Upload-Command': 'upload, finalize',
                    'X-Goog-Upload-Offset': '0',
                    'X-Tenant-Id': 'bard-storage'
                },
                body: imageData,
                credentials: 'include'
            })

            const imageFileLocation = await response.text()

            logger.debug(`image file location: ${imageFileLocation}`)

            return [[[imageFileLocation, 1], imageName]]
        } catch (e) {
            logger.error(`error in uploading image: ${e}`)
            if (e.cause) {
                logger.error(e.cause)
            }

            return []
        }
    }

    async init(): Promise<void> {
        this._bardRequestInfo = {
            requestId: new Random().int(10000, 450000)
        }

        this._bardWebRequestInfo = await this._getInitParams()

        logger.info(`bard init params: ${JSON.stringify(this._bardWebRequestInfo)}`)

        if (this._bardRequestInfo.conversation == null) {
            this._bardRequestInfo.conversation = {
                c: '',
                r: '',
                rc: ''
            }
        }
    }

    private async _parseResponse(response: string): Promise<BardResponse> {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        let rawResponse: any

        try {
            rawResponse = JSON.parse(response.split('\n')[3])[0][2]
        } catch {
            this.dispose()
            throw new ChatHubError(
                ChatHubErrorCode.API_REQUEST_FAILED,
                new Error(`Google Bard encountered an error: ${response}.`)
            )
        }

        if (rawResponse == null) {
            this.dispose()
            throw new ChatHubError(
                ChatHubErrorCode.API_REQUEST_FAILED,
                new Error(`Google Bard encountered an error: ${response}.`)
            )
        }

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const jsonResponse = JSON.parse(rawResponse) as any[]

        const images = await this._parseImages(jsonResponse)

        return {
            content: jsonResponse[4][0][1][0],
            conversationId: jsonResponse[1][0],
            responseId: jsonResponse[1][1],
            factualityQueries: jsonResponse[3],
            textQuery: jsonResponse[2]?.[0] ?? null,
            choices:
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                jsonResponse[4]?.map((i: any) => {
                    return {
                        id: i[0],
                        content: i[1]
                    }
                }) ?? null,
            images: images ?? []
        }
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    private async _parseImages(jsonResponse: any) {
        const rawImages: string[] = []

        if (jsonResponse.length >= 3) {
            if (jsonResponse[4][0].length >= 4) {
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                const jsonRawImages = jsonResponse[4][0][4] as any[]

                if (jsonRawImages != null) {
                    for (const img of jsonRawImages) {
                        rawImages.push(img[0][0][0])
                    }
                }
            }
        }

        // the images like this
        // [xxx]
        // [xxx]
        // link
        // link

        // so let's get the link and format it to markdown

        const images = []

        if (rawImages.length > 0) {
            if (tmpFile == null) {
                tmpFile = await fs.mkdtemp(path.join(os.tmpdir(), 'bard-'))
            }

            for (const url of rawImages) {
                try {
                    const filename = randomUUID() + '.png'

                    // download the image to the tmp dir

                    const image = await chathubFetch(url, {
                        method: 'GET'
                    })

                    // download the image to the tmp dir using fs

                    const tmpPath = `${tmpFile}/${filename}`

                    await fs.writeFile(tmpPath, image.body)

                    images.push(`![image](file://${tmpPath})`)
                } catch (e) {
                    logger.warn('bard: could not download image')
                    logger.warn(e)
                    images.push(`![image](${url})`)
                }
            }
        }

        return images
    }

    private _buildHeader(isUploadImage: boolean = false) {
        const base: typeof SESSION_HEADERS & { cookie?: string } = { ...SESSION_HEADERS }

        base.cookie = this._config.apiKey

        return base
    }

    private async _getInitParams() {
        try {
            const response = await chathubFetch('https://bard.google.com/', {
                method: 'GET',
                headers: {
                    'User-Agent':
                        'Mozilla/5.0 (Windows NT 10.0; WOW64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.114 Safari/537.36',
                    'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8',
                    cookie: this._config.apiKey
                },
                credentials: 'same-origin'
            })

            const html = await response.text()

            const result = {
                // match json SNlM0e value
                at: html.match(/"SNlM0e":"(.*?)"/)?.[1],
                bl: 'boq_assistant-bard-web-server_20230829.05_p3', // html.match(/"cfb2h":"(.*?)"/)?.[1],
                sid: html.match(/"FdrFJe":"(.*?)"/)?.[1]
            }

            if (result.at == null || result.bl == null || result.sid == null) {
                throw new ChatHubError(ChatHubErrorCode.MODEL_INIT_ERROR)
            }

            return result
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
        } catch (e: any) {
            throw new ChatHubError(ChatHubErrorCode.MODEL_INIT_ERROR, e)
        }
    }

    async dispose(): Promise<void> {
        this._bardRequestInfo = null
        this._bardWebRequestInfo = null
    }
}

// download image
let tmpFile: string
