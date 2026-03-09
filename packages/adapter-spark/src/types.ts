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
    user?: string
    stream?: boolean
    temperature?: number
    max_tokens?: number
    top_p?: number
    top_k?: number
    keep_alive?: boolean
    presence_penalty?: number
    frequency_penalty?: number
    tool_choice?: ChatCompletionToolChoice
    tool_calls_switch?: boolean
    tools?: ChatCompletionTool[]
    response_format?: ChatCompletionResponseFormat
    thinking?: ChatCompletionThinking
    suppress_plugin?: string[]
}

export interface ChatCompletionResponse {
    id?: string
    object?: string
    created?: number
    model?: string
    code?: number
    message?: string
    sid?: string
    status?: string | number
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
    tool_call_id?: string
}

export interface ChatCompletionUsage {
    prompt_tokens: number
    completion_tokens: number
    total_tokens: number
}

export interface ToolCall {
    id: string
    type: 'function'
    index?: number
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
    reasoning_content?: string
    tool_calls?: ToolCall[]
    tool_call_id?: string
}

export type ChatCompletionMessageRoleEnum =
    | 'system'
    | 'assistant'
    | 'user'
    | 'tool'

export type ChatCompletionToolChoice =
    | 'auto'
    | 'none'
    | 'required'
    | {
          type: 'function'
          name?: string
          function?: {
              name: string
          }
      }
    | {
          type: 'allowed_tools'
          mode: 'auto' | 'none' | 'required'
          tools: {
              type: 'function'
              name: string
          }[]
      }

export interface ChatCompletionResponseFormat {
    type: 'text' | 'json_object'
}

export interface ChatCompletionThinking {
    type: 'enabled' | 'disabled' | 'auto'
}

export interface SparkClientConfig extends ClientConfig {
    apiPasswords: Record<string, string>
}
