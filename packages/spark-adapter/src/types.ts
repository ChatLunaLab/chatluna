import { ClientConfig } from '@dingyi222666/koishi-plugin-chathub/lib/llm-core/platform/config'

export interface ChatCompletionResponse {
    header: {
        code: number
        message: string
        sid: string
        status: number
    }
    payload: {
        choices: {
            status: number
            seq: number
            text: ChatCompletionMessage[]
        }
        usage: {
            text: {
                question_tokens: number
                prompt_tokens: number
                completion_tokens: number
                total_tokens: number
            }
        }
    }
}

export interface ChatCompletionRequest {
    header: {
        app_id: string
        uid?: string
    }
    parameter: {
        chat: {
            domain: string
            temperature: number
            max_tokens?: number
            top_k?: number
        }
    }
    payload: {
        message: {
            text: ChatCompletionMessage[]
        }
    }
}

export interface ChatCompletionMessage {
    content: string
    role: ChatCompletionMessageRoleEnum
}

export type ChatCompletionMessageRoleEnum = 'system' | 'assistant' | 'user'

export interface SparkClientConfig extends ClientConfig {
    appId: string
    apiSecret: string
}
