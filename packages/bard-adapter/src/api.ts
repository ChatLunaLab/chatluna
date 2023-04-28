import { Context, Dict, Random } from 'koishi'

import { request, createLogger } from '@dingyi222666/koishi-plugin-chathub'
import PoeAdapter from './index'
import { load } from "cheerio";

import md5 from 'md5'
import WebSocket from 'ws';
import randomUserAgent from "random-useragent"
import { writeFileSync } from 'fs';
import { BardRequestInfo, BardRespone, BardWebReqeustInfo } from './types';

const logger = createLogger('@dingyi222666/chathub-poe-adapter/api')

export class Api {


    private headers: Dict<string, string> = {
        "Host": "bard.google.com",
        "X-Same-Domain": "1",
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; WOW64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.114 Safari/537.36",
        "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8",
        "Origin": "https://bard.google.com",
        "Referer": "https://bard.google.com/",
        "content-type": "application/json",
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
        //     "User-Agent": randomUserAgent.getRandom(),
    }

    private bardRequestInfo: BardRequestInfo

    private bardWebReqeustInfo?: BardWebReqeustInfo | null

    constructor(
        private readonly config: PoeAdapter.Config,
        private readonly ctx: Context
    ) {
        this.headers.Cookie = config.cookie
        this.bardRequestInfo = {
            requestId: new Random().int(10000, 99999),
        }

    }



    private async getRequestParams() {
        try {
            const response = await request.fetch("https://bard.google.com", {
                headers: this.headers
            });

            const html = await response.text()

            return {
                // match json SNlM0e value
                at: html.match(/"SNlM0e":"(.*?)"/)?.[1],
                bl: html.match(/"cfb2h":"(.*?)"/)?.[1],
            }
        } catch (e: any) {
            logger.error("Could not get bard")

            throw e
        }
    }


    async request(prompt: string): Promise<string | Error> {

        if (!this.bardWebReqeustInfo) {
            this.bardWebReqeustInfo = await this.getRequestParams()
        }

        if (this.bardRequestInfo.conversation == null) {
            this.bardRequestInfo.conversation = {
                id: "",
                c: "",
                r: "",
                rc: "",
            }
        }

        const bardRequestInfo = this.bardRequestInfo
        const params = new URLSearchParams({
            "bl": this.bardWebReqeustInfo.bl,
            "_reqid": this.bardRequestInfo.requestId.toString()，
            "rt": "c",
        })

        const data = new URLSearchParams({
            at: this.bardWebReqeustInfo.at,
            "f.req": JSON.stringify([null, `[[${JSON.stringify(prompt)}],null,${JSON.stringify([bardRequestInfo.conversation.c, bardRequestInfo.conversation.r, bardRequestInfo.conversation.rc])}]`]),
        }),


        const response = await request.fetch(
            "https://bard.google.com/_/BardChatUi/data/assistant.lamda.BardFrontendService/StreamGenerate?" + params.toString(), {
            method: "POST",
            body: data.toString(),
        })


        const bardRespone = parseResponse(await response.text())


        this.bardRequestInfo.conversation = {
            id: bardRespone.conversationId,
            c: bardRespone.content,
            r: bardRespone.responseId,
            rc: bardRespone.content,
        }

        // 暂时丢弃choices
        return bardRespone.content
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

    }

    if (rawResponse === null) {
        throw new Error(`Google Bard encountered an error: ${response}.`)
    }

    let jsonResponse = JSON.parse(rawResponse)

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

    }

}



