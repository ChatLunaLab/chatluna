import { UUID } from 'crypto'
import { Conversation, Message } from '@dingyi222666/koishi-plugin-chathub'

export type ToneStyle = 'balanced' | 'creative' | 'precise' | 'fast'

export interface ConversationResponse {
    conversationSignature: string,
    conversationId: string,
    clientId: string,
    result?: {
        value?: any,
        message: string
    }
}

export interface ClientRequest {
    conversation: Conversation,
    message: Message,
    toneStyle: ToneStyle,
    sydney?: boolean,
}

export interface ApiRequest {
    bingConversation: BingConversation,
    toneStyle: ToneStyle,
    sydney?: boolean,
    prompt: string,
}

export interface ApiResponse {
    conversation: BingConversation,
    message: any,
    respose: any
}

export interface BingMessage {
    author: string
    description: string,
    contextType: string,
    messageType: string,
    messageId: string
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