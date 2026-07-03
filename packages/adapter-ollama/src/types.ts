export type OllamaRole = 'system' | 'user' | 'assistant' | 'tool'

export type OllamaThink = boolean | 'low' | 'medium' | 'high' | 'max'

export interface OllamaRequest {
    model: string
    options: {
        temperature?: number
        top_k?: number
        top_p?: number
        stop?: string | string[]
        num_predict?: number
    }
    keep_alive?: number | string
    messages: OllamaMessage[]
    tools?: OllamaTool[]
    think?: OllamaThink
    stream: boolean
}

export interface OllamaDeltaResponse extends OllamaUsage {
    model: string
    created_at?: string
    message?: OllamaMessage
    done: boolean
    done_reason?: string
}

export interface OllamaMessage {
    role: OllamaRole
    content: string
    thinking?: string
    images?: string[]
    tool_calls?: OllamaToolCall[]
    tool_name?: string
}

export interface OllamaTool {
    type: 'function'
    function: {
        name: string
        description?: string
        parameters: Record<string, unknown>
    }
}

export interface OllamaToolCall {
    type?: 'function'
    id?: string
    function?: {
        index?: number
        name: string
        arguments: Record<string, unknown>
    }
}

export interface OllamaUsage {
    total_duration?: number
    load_duration?: number
    prompt_eval_count?: number
    prompt_eval_duration?: number
    eval_count?: number
    eval_duration?: number
}

export interface OllamaListResponse {
    models: OllamaModelSummary[]
}

export interface OllamaModelSummary {
    name: string
    model: string
    modified_at?: string
    size?: number
    digest?: string
    details?: OllamaModelDetails
}

export interface OllamaShowResponse {
    parameters?: string
    license?: string
    modified_at?: string
    details?: OllamaModelDetails
    template?: string
    capabilities?: string[]
    model_info?: Record<string, unknown>
}

export interface OllamaModelDetails {
    parent_model?: string
    format?: string
    family?: string
    families?: string[]
    parameter_size?: string
    quantization_level?: string
}

export interface OllamaEmbedRequest {
    model: string
    input: string | string[]
    keep_alive?: number | string
}

export interface OllamaEmbedResponse extends OllamaUsage {
    model: string
    embeddings: number[][]
}
