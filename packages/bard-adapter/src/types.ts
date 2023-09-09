export interface BardRequestInfo {
    requestId: number
    conversation?: BardConversation
}

export interface BardWebRequestInfo {
    at: string
    bl: string
    sid: string
}

export interface BardConversation {
    c: string // conversationId
    r: string // requestId
    rc: string // responseId
}

export interface BardChoice {
    id: string
    content: string
}

export interface BardResponse {
    content: string
    conversationId: string
    responseId: string
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    factualityQueries: any[]
    textQuery: string
    choices: BardChoice[]
    images?: string[]
    code?: [string, string]
}
