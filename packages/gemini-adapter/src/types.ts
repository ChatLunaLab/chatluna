export interface ChatCompletionResponseMessage {
    role: string
    parts?: (ChatMessagePart | ChatUploadDataPart)[]
}

export type ChatMessagePart = {
    text: string
}

export type ChatUploadDataPart = {
    mime_type: string
    data?: string
}

export interface ChatResponse {
    candidates: {
        content: ChatCompletionResponseMessage
        finishReason: string
        index: number
        safetyRatings: {
            category: string
            probability: string
        }[]
    }[]
    promptFeedback: {
        safetyRatings: {
            category: string
            probability: string
        }[]
    }
}

export interface CreateEmbeddingResponse {
    embedding: {
        values: number[]
    }
}

export type ChatCompletionResponseMessageRoleEnum = 'system' | 'model' | 'user'
