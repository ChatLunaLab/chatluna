
export interface BardRequestInfo {
    requestId: number,
    conversation?: BardConversation
}

export interface BardWebReqeustInfo {
    at: string,
    bl: string
}

export interface BardConversation {
    c: string; // conversationId
    r: string; // requestId
    rc: string; // responseId
}

export interface BardChoice {
    id: string,
    content: string
}

export interface BardRespone {
    // TODO: update any types
    content: string,
    conversationId: string,
    responseId: string,
    factualityQueries: any[],
    textQuery: string,
    choices: BardChoice[],
    images?: string[]
}
