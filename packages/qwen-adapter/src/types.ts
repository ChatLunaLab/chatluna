export interface ChatCompletionStreamResponse {
    output: {
        choices: {
            message: {
                content?: string
                role?: ChatCompletionResponseMessageRoleEnum
                name?: string
            }
            index: number
            finish_reason: string
        }[]
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
    | 'function'
    | 'tool'

export interface ChatCompletionFunction {
    name: string
    description?: string
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    parameters?: { [key: string]: any }
}

export interface ChatCompletionTool {
    type: string
    function: ChatCompletionFunction
}

export interface ChatCompletionRequestMessageToolCall {
    id: string
    type: 'function'
    function: {
        name: string
        arguments: string
    }
}

/**
 *
 * @export
 * @interface CreateEmbeddingResponse
 */
export interface CreateEmbeddingResponse {
    output: {
        embeddings: {
            text_index: number
            embedding: number[]
        }[]
    }
}

export interface CreateEmbeddingRequest {
    model: string
    input: string | string[]
}
