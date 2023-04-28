import { Conversation, Message } from '@dingyi222666/koishi-plugin-chathub'

export interface BardRequestInfo {
    requestId: number,
    conversation?: BardConversation
}

export interface BardWebReqeustInfo {
    at: string,
    bl: string
}

export interface BardConversation {
    id: string;
    c: string; // conversationId
    r: string; // requestId
    rc: string; // responseId
}

export interface BardChoice {
    id: string | number,
    content: string
}

export interface BardRespone {
    // TODO: update any types
    content: string,
    conversationId: string,
    responseId: string,
    factualityQueries: any[],
    textQuery: string,
    choices: BardChoice[]
}

