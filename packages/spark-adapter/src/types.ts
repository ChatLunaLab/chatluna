import { ClientConfig } from 'koishi-plugin-chatluna/llm-core/platform/config'

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
        functions?: {
            text: ChatCompletionTool[]
        }
    }
}

export interface ChatCompletionTool {
    name: string
    description: string
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    parameters: any
}

export interface ChatCompletionMessage {
    content: string
    role: ChatCompletionMessageRoleEnum
    name?: string
    function_call?: {
        arguments: string
        name: string
    }
}

export type ChatCompletionMessageRoleEnum =
    | 'system'
    | 'assistant'
    | 'user'
    | 'function_call'

export interface SparkClientConfig extends ClientConfig {
    appId: string
    apiSecret: string
}
