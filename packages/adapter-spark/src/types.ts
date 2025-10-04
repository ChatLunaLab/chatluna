import { ClientConfig } from 'koishi-plugin-chatluna/llm-core/platform/config'

// Legacy WebSocket types (kept for backwards compatibility)
export interface LegacyChatCompletionResponse {
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

export interface LegacyChatCompletionRequest {
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

// OpenAI-like HTTP API types
export interface ChatCompletionRequest {
    model: string
    messages: ChatCompletionMessage[]
    stream?: boolean
    temperature?: number
    max_tokens?: number
    top_p?: number
    tools?: ChatCompletionTool[]
}

export interface ChatCompletionResponse {
    id: string
    object: string
    created: number
    model: string
    choices: ChatCompletionChoice[]
    usage?: ChatCompletionUsage
}

export interface ChatCompletionChoice {
    index: number
    message?: ChatCompletionMessage
    delta?: ChatCompletionDelta
    finish_reason?: string
}

export interface ChatCompletionDelta {
    role?: string
    content?: string
    reasoning_content?: string
    tool_calls?: ToolCall[]
}

export interface ChatCompletionUsage {
    prompt_tokens: number
    completion_tokens: number
    total_tokens: number
}

export interface ToolCall {
    id: string
    type: 'function'
    function: {
        name: string
        arguments: string
    }
}

export interface ChatCompletionTool {
    type: 'function'
    function: {
        name: string
        description: string
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        parameters: any
    }
}

export interface ChatCompletionMessage {
    content: string | null
    role: ChatCompletionMessageRoleEnum
    name?: string
    tool_calls?: ToolCall[]
    tool_call_id?: string
}

export type ChatCompletionMessageRoleEnum =
    | 'system'
    | 'assistant'
    | 'user'
    | 'tool'

export interface SparkClientConfig extends ClientConfig {
    apiPasswords: Record<string, string>
}
