import { Context, Dict, Random } from 'koishi'

import { createLogger } from '@dingyi222666/chathub-llm-core/lib/utils/logger'
import { request } from '@dingyi222666/chathub-llm-core/lib/utils/request'


import { BardRequestInfo, BardRespone, BardWebReqeustInfo } from './types';
import BardPlugin from '.';

const logger = createLogger('@dingyi222666/chathub-bard-adapter/api')

export class Api {

    private headers: Dict<string, string> = {
        //   "Host": "bard.google.com",
        "X-Same-Domain": "1",
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; WOW64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.114 Safari/537.36",
        "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8",
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.5",
        "Accept-Encoding": "gzip, deflate, br",
        Connection: "keep-alive",
        "Upgrade-Insecure-Requests": "1",
        "Sec-Fetch-Dest": "document",
        "Sec-Fetch-Mode": "navigate",
        "Sec-Fetch-Site": "none",
        "Sec-Fetch-User": "?1",
        TE: "trailers",
    }

    private bardRequestInfo: BardRequestInfo

    private bardWebReqeustInfo?: BardWebReqeustInfo | null = null

    constructor(
        private readonly config: BardPlugin.Config
    ) {
        this.headers.Cookie = this.config.cookie
        this.bardRequestInfo = {
            requestId: new Random().int(100000, 450000),
        }
    }

    private async getRequestParams() {
        try {
            const response = await request.fetch("https://bard.google.com/", {
                method: "GET",
                headers: {
                    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; WOW64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.114 Safari/537.36",
                    "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8",
                    Cookie: this.config.cookie,
                },
                credentials: "same-origin"
            });

            const html = await response.text()


            const result = {
                // match json SNlM0e value
                at: html.match(/"SNlM0e":"(.*?)"/)?.[1],
                bl: html.match(/"cfb2h":"(.*?)"/)?.[1],
            }

            if (result.at == null || result.bl == null) {
                throw new Error("Could not get bard")
            }

            return result
        } catch (e: any) {
            logger.error("Could not get bard")

            throw e
        }
    }


    async request(prompt: string, signal?: AbortSignal): Promise<string | Error> {

        if (this.bardWebReqeustInfo == null) {
            this.bardWebReqeustInfo = await this.getRequestParams()
        }

        if (this.bardRequestInfo.conversation == null) {
            this.bardRequestInfo.conversation = {
                c: "",
                r: "",
                rc: "",
            }
        }

        const bardRequestInfo = this.bardRequestInfo
        const params = new URLSearchParams({
            "bl": this.bardWebReqeustInfo.bl,
            "_reqid": this.bardRequestInfo.requestId.toString(),
            "rt": "c",
        })

        const messageStruct = [
            [prompt],
            null,
            [bardRequestInfo.conversation.c, this.bardRequestInfo.conversation.r, bardRequestInfo.conversation.rc],
        ];

        const data = new URLSearchParams({
            'f.req': JSON.stringify([null, JSON.stringify(messageStruct)]),
            'at': this.bardWebReqeustInfo.at,
        })

        logger.debug(`bardWebReqeustInfo: ${JSON.stringify(this.bardWebReqeustInfo)}`)

        const url = "https://bard.google.com/_/BardChatUi/data/assistant.lamda.BardFrontendService/StreamGenerate?" + params.toString()

        const response = await request.fetch(
            url, {
            method: "POST",
            // ?
            body: data.toString(),
            headers: this.headers,
            signal: signal,
        })

        const bardRespone = parseResponse(await response.text())

        this.bardRequestInfo.requestId = this.bardRequestInfo.requestId + 100000
        this.bardRequestInfo.conversation = {
            c: bardRespone.conversationId,
            r: bardRespone.responseId,
            rc: bardRespone.choices[0].id,
        }


        const results: string[] = [bardRespone.content]

        // 暂时丢弃choices
        if (bardRespone.images.length > 0) {
            results.push(...bardRespone.images)
        }

        return results.join("\n")
    }


    clearConversation() {
        this.bardWebReqeustInfo = null
        this.bardRequestInfo.conversation = null
    }
}

function parseResponse(response: string): BardRespone {

    let rawResponse: any

    try {
        rawResponse = JSON.parse(response.split("\n")[3])[0][2]
    } catch {
        throw new Error(`Google Bard encountered an error: ${response}.`)
    }

    if (rawResponse == null) {
        throw new Error(`Google Bard encountered an error: ${response}.`)
    }

    logger.debug(`response: ${response}`)
    logger.debug(`rawResponse: ${rawResponse}`)

    let jsonResponse = JSON.parse(rawResponse) as any[]

    const images: string[] = []
    if (jsonResponse.length >= 3) {
        if (jsonResponse[4][0].length >= 4) {

            const rawImages = jsonResponse[4][0][4] as any[]

            if (rawImages != null) {
                for (const img of rawImages) {
                    images.push(img[0][0][0])
                }
            }
        }
    }

    return {
        "content": jsonResponse[0][0],
        "conversationId": jsonResponse[1][0],
        "responseId": jsonResponse[1][1],
        "factualityQueries": jsonResponse[3],
        "textQuery": jsonResponse[2]?.[0] ?? null,
        "choices": jsonResponse[4]?.map((i: any) => {
            return {
                id: i[0],
                content: i[1],
            }
        }) ?? null,
        images

    }

}


