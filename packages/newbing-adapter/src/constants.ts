import { v4 as uuidv4 } from "uuid"
import { BingConversationStyle, BingChatMessage, ConversationInfo, InvocationEventType, ChatResponseMessage } from './types'

/**
 * https://stackoverflow.com/a/58326357
 * @param {number} size
 */
export const genRanHex = (size) => [...Array(size)].map(() => Math.floor(Math.random() * 16).toString(16)).join('')


const random = (min: number, max: number) => Math.floor(Math.random() * (max - min + 1)) + min


export const randomIP =
    `13.${random(104, 107)}.${random(0, 255)}.${random(0, 255)}`


export const HEADERS_INIT_CONVER = {
    "authority": "edgeservices.bing.com",
    "accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7",
    "accept-language": "en-US,en;q=0.9",
    "cache-control": "max-age=0",
    "sec-ch-ua": '"Chromium";v="110", "Not A(Brand";v="24", "Microsoft Edge";v="110"',
    "sec-ch-ua-arch": '"x86"',
    "sec-ch-ua-bitness": '"64"',
    "sec-ch-ua-full-version": '"110.0.1587.69"',
    "sec-ch-ua-full-version-list": '"Chromium";v="110.0.5481.192", "Not A(Brand";v="24.0.0.0", "Microsoft Edge";v="110.0.1587.69"',
    "sec-ch-ua-mobile": "?0",
    "sec-ch-ua-model": '""',
    "sec-ch-ua-platform": '"Windows"',
    "sec-ch-ua-platform-version": '"15.0.0"',
    "sec-fetch-dest": "document",
    "sec-fetch-mode": "navigate",
    "sec-fetch-site": "none",
    "sec-fetch-user": "?1",
    "upgrade-insecure-requests": "1",
    "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/110.0.0.0 Safari/537.36 Edg/110.0.1587.69",
    "x-edge-shopping-flag": "1",
    "x-forwarded-for": randomIP,
}

export const HEADERS = {
    "accept": "application/json",
    "accept-language": "en-US,en;q=0.9",
    "content-type": "application/json",
    "sec-ch-ua": '"Not_A Brand";v="99", "Microsoft Edge";v="110", "Chromium";v="110"',
    "sec-ch-ua-arch": '"x86"',
    "sec-ch-ua-bitness": '"64"',
    "sec-ch-ua-full-version": '"109.0.1518.78"',
    "sec-ch-ua-full-version-list": '"Chromium";v="110.0.5481.192", "Not A(Brand";v="24.0.0.0", "Microsoft Edge";v="110.0.1587.69"',
    "sec-ch-ua-mobile": "?0",
    "sec-ch-ua-model": "",
    "sec-ch-ua-platform": '"Windows"',
    "sec-ch-ua-platform-version": '"15.0.0"',
    "sec-fetch-dest": "empty",
    "sec-fetch-mode": "cors",
    "sec-fetch-site": "same-origin",
    "x-ms-client-request-id": uuidv4(),
    "x-ms-useragent": "azsdk-js-api-client-factory/1.0.0-beta.1 core-rest-pipeline/1.10.0 OS/Win32",
    "Referer": "https://www.bing.com/search?q=Bing+AI&showconv=1&FORM=hpcodx",
    "Referrer-Policy": "origin-when-cross-origin",
    "x-forwarded-for": randomIP,
}


const styleOptionsMap: Record<BingConversationStyle, string[]> = {
    [BingConversationStyle.Balanced]: [
        "nlu_direct_response_filter",
        "deepleo",
        "disable_emoji_spoken_text",
        "responsible_ai_policy_235",
        "enablemm",
        "galileo",
        "dv3sugg",
        "responseos",
        "e2ecachewrite",
        "cachewriteext",
        "nodlcpcwrite",
        "travelansgnd",
        "nojbfedge",
    ],
    [BingConversationStyle.Creative]: [
        "nlu_direct_response_filter",
        "deepleo",
        "disable_emoji_spoken_text",
        "responsible_ai_policy_235",
        "enablemm",
        "h3imaginative",
        "clgalileo",
        //  "gencontentv3",
        "rcsprtsalwlst",
        "bof107",
        "dagslnv1",
        "sportsansgnd",
        "enablenewsfc",
        "dv3sugg"
    ],
    [BingConversationStyle.Precise]: [
        "nlu_direct_response_filter",
        "deepleo",
        "disable_emoji_spoken_text",
        "responsible_ai_policy_235",
        "enablemm",
        "h3precise",
        "rcsprtsalwlst",
        "bof107",
        "dagslnv1",
        "sportsansgnd",
        "enablenewsfc",
        "dv3sugg",
        "clgalileo",
        //  "gencontentv3",
        "h3precigencon"
    ],
}


export function buildChatRequest(
    conversation: ConversationInfo,
    prompt: string,
    sydney?: boolean,
) {
    const optionsSets = styleOptionsMap[conversation.conversationStyle]
    const result = {
        arguments: [
            {
                source: 'cib',
                optionsSets,
                allowedMessageTypes: [
                    "ActionRequest",
                    "Chat",
                    "Context",
                    "InternalSearchQuery",
                    "InternalSearchResult",
                    "Disengaged",
                    "InternalLoaderMessage",
                    "Progress",
                    "RenderCardRequest",
                    "AdsQuery",
                    "SemanticSerp",
                    "GenerateContentQuery",
                    "SearchQuery"
                ],
                sliceIds: [
                    "winmuid3tf",
                    "ssoverlap0",
                    "sswebtop1",
                    "forallv2nsc",
                    "allnopvt",
                    "dtvoice2",
                    "512suptones0",
                    "mlchatpc1",
                    "mlchatpcbase",
                    "winlongmsg2tf",
                    "workpayajax",
                    "norespwtf",
                    "tempcacheread",
                    "temptacache",
                    "wrapnoins",
                    "505iccrics0",
                    "505scss0",
                    "508jbcars0",
                    "515enbotdets0",
                    "5082tsports",
                    "505bof107",
                    "424dagslnv1sp",
                    "427startpm",
                    "427vserps0",
                    "512bicp1"
                ],
                traceId: genRanHex(32),
                spokenTextMode: "None",
                isStartOfSession: conversation.invocationId === 0,
                message: {
                    author: 'user',
                    inputMethod: 'Keyboard',
                    text: sydney ? '' : prompt,
                    messageType: sydney ? 'SearchQuery' : 'Chat',
                },
                conversationId: conversation.conversationId,
                conversationSignature: conversation.conversationSignature,
                participant: { id: conversation.clientId },
                previousMessages: [],
            },
        ],
        invocationId: conversation.invocationId.toString(),
        target: 'chat',
        type: InvocationEventType.StreamInvocation,
    }

    if (sydney) {
        result.arguments[0].previousMessages.push({
            author: 'user',
            description: prompt,
            contextType: 'WebPage',
            messageType: 'Context',
            messageId: 'discover-web--page-ping-mriduna-----'
        })
    }

    if (result.arguments[0].previousMessages.length === 0) {
        delete result.arguments[0].previousMessages
    }

    return result
}


export function convertMessageToMarkdown(message: ChatResponseMessage): string {
    if (message.messageType === 'InternalSearchQuery' || message.adaptiveCards == null && message.text != null) {
        return message.text
    }
    for (const card of message.adaptiveCards) {
        for (const block of card.body) {
            if (block.type === 'TextBlock') {
                return block.text
            }
        }
    }
    return ''
}

export const RecordSeparator = String.fromCharCode(30)

export function serial(object: any): string {
    return JSON.stringify(object) + RecordSeparator
}

export function unpackResponse(data: string | ArrayBuffer | Blob) {
    return data
        .toString()
        .split(RecordSeparator)
        .filter(Boolean)
        .map((s) => JSON.parse(s))
}