export type WenxinMessageRole = 'assistant' | 'user' | 'system'

/*
 * Interface representing a message in the Wenxin chat model.
 */
export interface WenxinMessage {
    role: WenxinMessageRole
    content: string
}

/**
 * Interface representing the usage of tokens in a chat completion.
 */
export interface TokenUsage {
    completionTokens?: number
    promptTokens?: number
    totalTokens?: number
}

/**
 * Interface representing a request for a chat completion.
 */
export interface ChatCompletionRequest {
    messages: WenxinMessage[]
    stream?: boolean
    user_id?: string
    temperature?: number
    top_p?: number
    penalty_score?: number
    system?: string
}

/**
 * Interface representing a response from a chat completion.
 */
export interface ChatCompletionResponse {
    id: string
    object: string
    created: number
    result: string
    need_clear_history: boolean
    usage: TokenUsage
}
