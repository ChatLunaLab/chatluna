export interface ChatCompletionResponseMessage {
    role: string
    parts?: ChatPart[]
}

export type BaseChatPart = {
    thoughtSignature?: string
    thought?: boolean
}

export type ChatPart = BaseChatPart &
    (
        | ChatMessagePart
        | (ChatInlineDataPart & { mediaProcessing?: 'AGENTIC' })
        | ChatFunctionCallingPart
        | ChatFunctionResponsePart
        | ChatToolContextPart
        | (ChatUploadDataPart & { media_processing?: 'AGENTIC' })
        // Only used for token
        | ChatUsageMetadataPart
    )

export type ChatMessagePart = {
    text: string
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
        args?: Record<string, unknown>
        id?: string
    }
}

export type ChatFunctionResponsePart = {
    functionResponse: {
        name: string
        response: Record<string, unknown>
        parts?: (ChatInlineDataPart | ChatUploadDataPart)[]
        id?: string
    }
}

export type ChatToolCall = {
    id?: string
    toolType?: string
    [key: string]: unknown
}

export type ChatToolContextPart = {
    toolCall?: ChatToolCall
    toolResponse?: ChatToolCall
    executableCode?: Record<string, unknown>
    codeExecutionResult?: Record<string, unknown>
}

export type ChatThoughtPart = BaseChatPart & ChatToolContextPart

// Current histories use parts and call IDs; older ones also store a part directly.
export type ChatThoughtData = ChatThoughtPart & {
    parts?: ChatThoughtPart[]
    [key: string]:
        | string
        | boolean
        | ChatThoughtPart
        | ChatThoughtPart[]
        | Record<string, unknown>
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
    parameters?: Record<string, unknown>
}

export interface ChatTool {
    functionDeclarations?: ChatCompletionFunction[]
    google_search?: {
        searchTypes?: {
            webSearch: Record<string, never>
            imageSearch: Record<string, never>
        }
    }
    code_execution?: Record<string, never>
    urlContext?: Record<string, never>
}

export interface ChatCompletionMessageFunctionCall {
    name: string
    args?: Record<string, unknown>
}

export interface CreateEmbeddingResponse {
    embeddings: {
        values: number[]
    }[]
}

export type ChatCompletionResponseMessageRoleEnum =
    'system' | 'model' | 'user' | 'function'

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
