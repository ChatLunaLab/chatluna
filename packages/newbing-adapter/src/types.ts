export interface ConversationResponse {
    conversationSignature: string,
    conversationId: string,
    clientId: string,
    result?: {
        value?: any,
        message: string
    }
}

export interface ClientOptions {
    
}