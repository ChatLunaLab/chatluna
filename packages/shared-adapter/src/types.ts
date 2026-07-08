export interface OpenAIError {
    code?: string
    message?: string
}

export const UNSAFE_OPENAI_ERROR_CODES = [
    'content_filter',
    'content_policy_violation',
    'image_content_policy_violation'
]

export interface ChatCompletionResponse {
    choices: {
        index: number
        finish_reason: string | null
        delta: {
            content?: string
            role?: string
            reasoning_content?: string
            function_call?: ChatCompletionRequestMessageToolCall
            tool_calls?: ChatCompletionRequestMessageToolCall[]
        }
        message: ChatCompletionResponseMessage
    }[]
    id: string
    object: string
    created: number
    model: string
    usage?: ChatCompletionUsage
    error?: OpenAIError
}

export interface ChatCompletionPromptTokensDetails {
    audio_tokens?: number
    cached_tokens?: number
}

export interface ChatCompletionCompletionTokensDetails {
    reasoning_tokens?: number
    audio_tokens?: number
}

export interface ChatCompletionUsage {
    prompt_tokens: number
    completion_tokens: number
    total_tokens: number
    prompt_tokens_details?: ChatCompletionPromptTokensDetails
    completion_tokens_details?: ChatCompletionCompletionTokensDetails
}

export interface ResponseUsage {
    input_tokens: number
    output_tokens: number
    total_tokens: number
    input_tokens_details?: {
        cached_tokens?: number
    }
    output_tokens_details?: {
        reasoning_tokens?: number
    }
}

export type ResponseInputContent =
    | {
          type: 'input_text'
          text: string
      }
    | {
          type: 'input_image'
          image_url: string
          detail?: 'low' | 'high' | 'auto' | 'original'
      }
    | {
          type: 'input_file'
          file_url?: string
          file_data?: string
          file_id?: string
          filename?: string
      }

export type ResponseInputItem =
    | {
          type: 'message'
          role: 'system' | 'developer' | 'user' | 'assistant'
          content: string | ResponseInputContent[]
      }
    | {
          type: 'function_call'
          call_id: string
          name: string
          arguments: string
          status?: 'completed' | 'in_progress' | 'incomplete'
      }
    | {
          type: 'function_call_output'
          call_id: string
          output: string | ResponseInputContent[]
      }

export type ResponseBuiltinToolName =
    | 'web_search'
    | 'web_search_preview'
    | 'image_generation'
    | 'code_interpreter'
    | 'file_search'

export type ResponseBuiltinTool =
    | {
          type: 'web_search' | 'web_search_2025_08_26'
          filters?: {
              allowed_domains?: string[] | null
          } | null
          search_context_size?: 'low' | 'medium' | 'high'
          user_location?: {
              city?: string | null
              country?: string | null
              region?: string | null
              timezone?: string | null
              type?: 'approximate'
          } | null
      }
    | {
          type: 'web_search_preview' | 'web_search_preview_2025_03_11'
          search_content_types?: ('text' | 'image')[]
          search_context_size?: 'low' | 'medium' | 'high'
          user_location?: {
              type: 'approximate'
              city?: string | null
              country?: string | null
              region?: string | null
              timezone?: string | null
          } | null
      }
    | {
          type: 'image_generation'
          action?: 'generate' | 'edit' | 'auto'
          background?: 'transparent' | 'opaque' | 'auto'
          input_fidelity?: 'high' | 'low' | null
          input_image_mask?: {
              file_id?: string
              image_url?: string
          }
          model?: string
          moderation?: 'auto' | 'low'
          output_compression?: number
          output_format?: 'png' | 'webp' | 'jpeg'
          partial_images?: number
          quality?: 'low' | 'medium' | 'high' | 'auto'
          size?: '1024x1024' | '1024x1536' | '1536x1024' | 'auto'
      }
    | {
          type: 'code_interpreter'
          container:
              | string
              | {
                    type: 'auto'
                    file_ids?: string[]
                    memory_limit?: '1g' | '4g' | '16g' | '64g' | null
                }
      }
    | {
          type: 'file_search'
          vector_store_ids: string[]
          filters?: Record<string, unknown> | null
          max_num_results?: number
          ranking_options?: {
              ranker?: 'auto' | 'default-2024-11-15'
              score_threshold?: number
              hybrid_search?: {
                  embedding_weight: number
                  text_weight: number
              }
          }
      }

export type ResponseTool =
    | {
          type: 'function'
          name: string
          description?: string
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          parameters?: { [key: string]: any }
          strict?: boolean
      }
    | ResponseBuiltinTool

export interface ResponseObject {
    id: string
    object: 'response'
    output_text?: string
    output?: ResponseOutputItem[]
    usage?: ResponseUsage
    error?: OpenAIError | null
    incomplete_details?: { reason?: string } | null
    conversation?: { id: string } | null
}

export type ResponseOutputItem =
    | {
          type: 'message'
          role?: string
          content?: ResponseOutputContent[]
      }
    | {
          type: 'function_call'
          id?: string
          call_id: string
          name: string
          arguments: string
          status?: string
      }
    | {
          type: 'image_generation_call'
          id?: string
          result?: string | null
          output_format?: 'png' | 'jpeg' | 'webp'
          status?: string
      }
    | {
          type: string
          [key: string]: unknown
      }

export type ResponseOutputContent =
    | {
          type: 'output_text'
          text: string
      }
    | {
          type: 'refusal'
          refusal: string
      }
    | {
          type: string
          [key: string]: unknown
      }

export interface ResponseStreamEvent {
    type: string
    sequence_number?: number
    code?: string | null
    message?: string
    item_id?: string
    output_index?: number
    content_index?: number
    delta?: string
    text?: string
    name?: string
    arguments?: string
    item?: ResponseOutputItem
    response?: ResponseObject
    partial_image_b64?: string
}

export interface ChatCompletionTextPart {
    type: 'text'
    text: string
}

export interface ChatCompletionImagePart {
    type: 'image_url'
    image_url:
        | string
        | {
              url: string
              detail?: 'low' | 'high'
          }
}

export type ChatCompletionParts =
    | ChatCompletionTextPart
    | ChatCompletionImagePart
    | (Record<string, unknown> & { type: string })
export interface ChatCompletionResponseMessage {
    role: string
    content?: string | ChatCompletionParts[]
    reasoning_content?: string
    name?: string
    tool_calls?: ChatCompletionRequestMessageToolCall[]
    tool_call_id?: string
}

export interface ChatCompletionFunction {
    name: string
    description?: string
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    parameters?: { [key: string]: any }
}

export interface ChatCompletionTool {
    type: string
    function: ChatCompletionFunction
}

export interface ChatCompletionRequestMessageToolCall {
    id: string
    type: 'function'
    index?: number
    function: {
        name: string
        arguments: string
    }
}

export interface CreateEmbeddingResponse {
    object: string
    model: string
    data: CreateEmbeddingResponseDataInner[]
    usage: CreateEmbeddingResponseUsage
}

export interface CreateEmbeddingRequest {
    model: string
    input: string | string[]
}

export interface CreateEmbeddingResponseDataInner {
    index: number
    object: string
    embedding: number[]
}

export interface CreateEmbeddingResponseUsage {
    prompt_tokens: number
    total_tokens: number
}

export type ChatCompletionResponseMessageRoleEnum =
    'system' | 'assistant' | 'user' | 'function' | 'tool'

export interface CreateRerankRequest {
    model: string
    query: string
    documents: string[]
    top_n?: number
    max_chunks_per_doc?: number
    return_documents?: boolean
}

export interface RerankResultItem {
    index: number
    relevance_score: number
    document?: { text: string }
}

export interface CreateRerankResponse {
    id?: string
    model?: string
    results: RerankResultItem[]
    usage?: { prompt_tokens?: number; total_tokens?: number }
}
