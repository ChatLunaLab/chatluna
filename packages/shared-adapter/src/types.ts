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
}

export interface ChatCompletionPromptTokensDetails {
    audio_tokens?: number
    cached_tokens?: number
}

export interface ChatCompletionCompletionTokensDetails {
    reasoning_tokens?: number
    audio_tokens?: number
    accepted_prediction_tokens?: number
    rejected_prediction_tokens?: number
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

export interface ResponseTool {
    type: 'function'
    name: string
    description?: string
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    parameters?: { [key: string]: any }
    strict?: boolean
}

export interface ResponseObject {
    id: string
    object: 'response'
    output_text?: string
    output?: ResponseOutputItem[]
    usage?: ResponseUsage
    error?: { message?: string } | null
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

/**
 *
 * @export
 * @interface CreateEmbeddingResponse
 */
export interface CreateEmbeddingResponse {
    /**
     *
     * @type {string}
     * @memberof CreateEmbeddingResponse
     */
    object: string
    /**
     *
     * @type {string}
     * @memberof CreateEmbeddingResponse
     */
    model: string
    /**
     *
     * @type {Array<CreateEmbeddingResponseDataInner>}
     * @memberof CreateEmbeddingResponse
     */
    data: CreateEmbeddingResponseDataInner[]
    /**
     *
     * @type {CreateEmbeddingResponseUsage}
     * @memberof CreateEmbeddingResponse
     */
    usage: CreateEmbeddingResponseUsage
}

export interface CreateEmbeddingRequest {
    model: string
    input: string | string[]
}

/**
 *
 * @export
 * @interface CreateEmbeddingResponseDataInner
 */
export interface CreateEmbeddingResponseDataInner {
    /**
     *
     * @type {number}
     * @memberof CreateEmbeddingResponseDataInner
     */
    index: number
    /**
     *
     * @type {string}
     * @memberof CreateEmbeddingResponseDataInner
     */
    object: string
    /**
     *
     * @type {Array<number>}
     * @memberof CreateEmbeddingResponseDataInner
     */
    embedding: number[]
}
/**
 *
 * @export
 * @interface CreateEmbeddingResponseUsage
 */
export interface CreateEmbeddingResponseUsage {
    /**
     *
     * @type {number}
     * @memberof CreateEmbeddingResponseUsage
     */
    prompt_tokens: number
    /**
     *
     * @type {number}
     * @memberof CreateEmbeddingResponseUsage
     */
    total_tokens: number
}

export type ChatCompletionResponseMessageRoleEnum =
    | 'system'
    | 'assistant'
    | 'user'
    | 'function'
    | 'tool'
