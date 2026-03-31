export interface ChatCompletionResponseMessage {
    role: string
    parts?: ChatPart[]
}

export type BaseChatPart = {
    thoughtSignature?: string
}

export type ChatPart =
    | (ChatMessagePart & BaseChatPart)
    | ChatInlineDataPart
    | (ChatFunctionCallingPart & BaseChatPart)
    | ChatFunctionResponsePart
    | ChatUploadDataPart
    // Only used for token
    | ChatUsageMetadataPart

export type ChatMessagePart = {
    text: string
    thought?: boolean
}

export type ChatUsageMetadataPart = {
    usage: {
        promptTokens: number
        completionTokens: number
        totalTokens: number
        inputAudioTokens?: number
        inputImageTokens?: number
        outputImageTokens?: number
        outputAudioTokens?: number
        cacheReadTokens?: number
        reasoningTokens?: number
    }
}

export type GeminiModalityTokenCount = {
    modality: string
    tokenCount: number
}

export type GeminiUsageMetadata = {
    promptTokenCount: number
    cachedContentTokenCount?: number
    candidatesTokenCount?: number
    toolUsePromptTokenCount?: number
    thoughtsTokenCount?: number
    totalTokenCount: number
    promptTokensDetails?: GeminiModalityTokenCount[]
    cacheTokensDetails?: GeminiModalityTokenCount[]
    candidatesTokensDetails?: GeminiModalityTokenCount[]
    toolUsePromptTokensDetails?: GeminiModalityTokenCount[]
}

export type ChatInlineDataPart = {
    inlineData: {
        mimeType: string
        displayName?: string
        data?: string
    }
}

export type ChatUploadDataPart = {
    inline_data: {
        mime_type: string
        data?: string
    }
}

export type ChatFunctionCallingPart = {
    functionCall: {
        name: string
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        args?: any
        id?: string
    }
}

export type ChatFunctionResponsePart = {
    functionResponse: {
        name: string
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        response?: any
        parts?: (ChatMessagePart | ChatInlineDataPart | ChatUploadDataPart)[]
        id?: string
    }
}

export interface ChatResponse {
    candidates: {
        content: ChatCompletionResponseMessage
        tokenCount?: number
        groundingMetadata: {
            searchEntryPoint: {
                renderedContent: string
            }
            groundingChunks: {
                web: {
                    uri: string
                    title: string
                }
            }[]
            groundingSupports: {
                segment: {
                    endIndex: number
                    text: string
                }
                groundingChunkIndices: number[]
                confidenceScores: number[]
            }[]
            webSearchQueries: string[]
        }
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
    usageMetadata?: GeminiUsageMetadata
}

export interface ChatCompletionFunction {
    name: string
    description?: string
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    parameters?: { [key: string]: any }
}

export interface ChatCompletionMessageFunctionCall {
    name: string
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    args?: any
}

export interface CreateEmbeddingResponse {
    embeddings: {
        values: number[]
    }[]
}

export type ChatCompletionResponseMessageRoleEnum =
    | 'system'
    | 'model'
    | 'user'
    | 'function'

export interface GeminiModelInfo {
    name: string
    version: string
    displayName: string
    description: string
    inputTokenLimit: number
    outputTokenLimit: number
    supportedGenerationMethods: string[]
    temperature: number
    topP: number
    topK: number
    maxTemperature: number
}
