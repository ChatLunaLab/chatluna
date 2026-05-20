export type ModelUsageCallType = 'llm' | 'embeddings' | 'reranker'

export interface ModelUsagePayload {
    source: string
    callType: ModelUsageCallType
    platform: string
    model: string
    inputTokens: number
    outputTokens: number
    totalTokens: number
    estimated: boolean
    createdAt: Date
    conversationId?: string
    requestId?: string
    userId?: string
    guildId?: string
}

export type ModelUsageInput = Omit<
    ModelUsagePayload,
    'source' | 'createdAt' | 'platform' | 'model'
> & {
    source?: string
    createdAt?: Date
    platform?: string
    model?: string
}

export type ModelUsageReporter = (
    usage: ModelUsageInput
) => Promise<void> | void

export interface UsageContext {
    source: string
    conversationId?: string
    requestId?: string
    userId?: string
    guildId?: string
}
