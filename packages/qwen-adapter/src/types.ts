export interface ChatCompletionStreamResponse {
    output: {
        finish_reason: string
        text: string
    }
}

export interface ChatCompletionMessage {
    role: string
    content?: string
    name?: string
}

export type ChatCompletionResponseMessageRoleEnum =
    | 'system'
    | 'assistant'
    | 'user'
