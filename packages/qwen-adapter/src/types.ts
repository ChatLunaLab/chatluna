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
