import { ClientConfig } from 'koishi-plugin-chatluna/llm-core/platform/config'

export interface ChatCompletionResponse {
    choices: {
        index: number
        finish_reason: string | null
        delta: {
            content?: string
            role?: string
            tool_calls?: ChatCompletionRequestMessageToolCall
        }
        message: ChatCompletionResponseMessage
    }[]
    id: string
    object: string
    created: number
    model: string
    usage: {
        prompt_tokens: number
        completion_tokens: number
        total_tokens: number
    }
}

export interface ChatCompletionResponseMessage {
    role: string
    content?:
        | string
        | (
              | {
                    type: 'text'
                    text: string
                }
              | {
                    type: 'image_url'
                    image_url: {
                        url: string
                        detail?: 'low' | 'high'
                    }
                }
          )[]
    name?: string
    tool_calls?: ChatCompletionRequestMessageToolCall[]
}

export interface ChatCompletionFunction {
    name: string
    description?: string
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    parameters?: { [key: string]: any }
}

export interface ChatCompletionRequestMessageToolCall {
    id: string
    type: 'function' | 'web_search' | 'retrieval'
    function?: {
        name: string
        arguments: string
    }
    retrieval?: {
        knowledge_id: string
        prompt_template?: string
    }
    web_search?: {
        enable: boolean
    }
}

export interface ChatCompletionTool {
    type:
        | 'function'
        | 'web_search'
        | 'retrieval'
        | 'code_interpreter'
        | 'web_browser'
    function?: {
        name: string
        description: string
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        parameters?: any
    }
    retrieval?: {
        knowledge_id: string
        prompt_template?: string
    }
    web_search?: {
        enable: boolean
    }
    code_interpreter?: {
        sandbox?: 'sandbox'
    }
    web_browser?: {
        browser?: 'auto'
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

export interface ZhipuClientConfig extends ClientConfig {
    webSearch?: boolean
    retrieval?: string[]
    knowledgePromptTemplate?: string
    codeInterpreter?: boolean
}
