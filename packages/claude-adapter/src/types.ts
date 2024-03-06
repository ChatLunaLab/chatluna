export interface ClaudeRequest {
    model: string
    max_tokens: number
    temperature?: number
    top_p?: number
    top_k?: number
    stream?: boolean
    stop_sequences?: string[]
    messages: ClaudeMessage[]
}

export interface ClaudeMessage {
    role: string
    content?:
        | string
        | (
              | {
                    type: 'text'
                    text: string
                }
              | {
                    type: 'image'
                    source: {
                        type: string
                        media_type: string
                        data: string
                    }
                }
          )[]
}

export interface ClaudeDeltaResponse {
    type: string
    index: number
    delta: {
        type: string
        text: string
    }
}
