import { UUID } from 'crypto'

export interface ConversationResponse {
    conversationSignature: string,
    conversationId: string,
    clientId: string,
    result?: {
        value?: any,
        message: string
    }
}

export type ToneStyle = 'balanced' | 'creative' | 'precise' | 'fast'

export interface ClientRequestOptions {
    conversation: BingConversation,
    toneStyle: ToneStyle,
    abortController?: AbortController,
    parentMessageId?: string,
    timeout?: number,
    onProgress?: (result: string | any) => void,
}

export interface BingMessage {
    role: 'user' | 'model' | 'system',
    id: UUID,
    message: string,
}

export interface BingConversation {
    conversationSignature?: string,
    conversationId?: string,
    clientId?: string,
    expiryTime?: number,
    invocationId?: number,
}

export interface ClientResponse {
    conversation: BingConversation,
    message: string,
    details: any
}