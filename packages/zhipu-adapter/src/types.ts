export interface ChatCompletionRequest {
    prompt: ChatCompletionMessage[]
    temperature?: number
    top_p?: number
    model?: string
    incremental?: boolean
}

export interface ChatCompletionMessage {
    role: string
    content?: string
    name?: string
}

export type ChatCompletionMessageRoleEnum = 'system' | 'assistant' | 'user' | 'function'
