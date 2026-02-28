export interface ClaudeRequest {
    model: string
    max_tokens: number
    temperature?: number
    top_p?: number
    top_k?: number
    stream?: boolean
    stop_sequences?: string[]
    messages: ClaudeMessage[]
    tools?: CluadeTool[]
    thinking?: {
        type: 'enabled' | 'disabled'
        budget_tokens: number
    }
}

export interface CluadeTool {
    name: string
    description: string
    input_schema: object
}

type ClaudeCacheControlEphemeral = {
    type: 'ephemeral'
    ttl?: '5m' | '1h'
}

type ClaudeTextCitationParam =
    | {
          type: 'char_location'
          cited_text: string
          document_index: number
          document_title: string
          start_char_index: number
          end_char_index: number
      }
    | {
          type: 'page_location'
          cited_text: string
          document_index: number
          document_title: string
          start_page_number: number
          end_page_number: number
      }
    | {
          type: 'content_block_location'
          cited_text: string
          document_index: number
          document_title: string
          start_block_index: number
          end_block_index: number
      }
    | {
          type: 'web_search_result_location'
          cited_text: string
          encrypted_index: string
          title: string
          url: string
      }
    | {
          type: 'search_result_location'
          cited_text: string
          search_result_index: number
          source: string
          title: string
          start_block_index: number
          end_block_index: number
      }

type ClaudeTextBlockParam = {
    type: 'text'
    text: string
    cache_control?: ClaudeCacheControlEphemeral
    citations?: ClaudeTextCitationParam[]
}

type ClaudeImageSourceParam =
    | {
          type: 'base64'
          media_type: string
          data: string
      }
    | {
          type: 'url'
          url: string
      }

type ClaudeImageBlockParam = {
    type: 'image'
    source: ClaudeImageSourceParam
    cache_control?: ClaudeCacheControlEphemeral
}

type ClaudeContentBlockSourceContent =
    | ClaudeTextBlockParam
    | ClaudeImageBlockParam

type ClaudeDocumentSourceParam =
    | {
          type: 'base64'
          media_type: 'application/pdf'
          data: string
      }
    | {
          type: 'text'
          media_type: 'text/plain'
          data: string
      }
    | {
          type: 'content'
          content: string | ClaudeContentBlockSourceContent[]
      }
    | {
          type: 'url'
          url: string
      }

type ClaudeDocumentBlockParam = {
    type: 'document'
    source: ClaudeDocumentSourceParam
    cache_control?: ClaudeCacheControlEphemeral
    citations?: { enabled?: boolean }
    context?: string
    title?: string
}

type ClaudeSearchResultBlockParam = {
    type: 'search_result'
    title: string
    source: string
    content: ClaudeTextBlockParam[]
    cache_control?: ClaudeCacheControlEphemeral
    citations?: { enabled?: boolean }
}

type ClaudeToolUseBlockParam = {
    type: 'tool_use'
    id: string
    name: string
    input: Record<string, unknown>
    cache_control?: ClaudeCacheControlEphemeral
}

type ClaudeToolResultContentBlockParam =
    | ClaudeTextBlockParam
    | ClaudeImageBlockParam
    | ClaudeSearchResultBlockParam
    | ClaudeDocumentBlockParam
    | {
          type: 'tool_reference'
          tool_name: string
          cache_control?: ClaudeCacheControlEphemeral
      }

type ClaudeToolResultBlockParam = {
    type: 'tool_result'
    tool_use_id: string
    content?: string | ClaudeToolResultContentBlockParam[]
    cache_control?: ClaudeCacheControlEphemeral
    is_error?: boolean
}

type ClaudeMessageContentBlockParam =
    | ClaudeTextBlockParam
    | ClaudeImageBlockParam
    | ClaudeDocumentBlockParam
    | ClaudeSearchResultBlockParam
    | ClaudeToolUseBlockParam
    | ClaudeToolResultBlockParam
    | {
          type: 'thinking'
          thinking: string
          signature: string
      }
    | {
          type: 'redacted_thinking'
          data: string
      }
    | {
          type: 'server_tool_use'
          id: string
          name:
              | 'web_search'
              | 'web_fetch'
              | 'code_execution'
              | 'bash_code_execution'
              | 'text_editor_code_execution'
              | 'tool_search_tool_regex'
              | 'tool_search_tool_bm25'
          input: Record<string, unknown>
          cache_control?: ClaudeCacheControlEphemeral
      }
    | {
          type: 'web_search_tool_result'
          tool_use_id: string
          content: unknown
          cache_control?: ClaudeCacheControlEphemeral
      }
    | {
          type: 'web_fetch_tool_result'
          tool_use_id: string
          content: unknown
          cache_control?: ClaudeCacheControlEphemeral
      }
    | {
          type: 'code_execution_tool_result'
          tool_use_id: string
          content: unknown
          cache_control?: ClaudeCacheControlEphemeral
      }

export interface ClaudeMessage {
    role: ChatCompletionResponseMessageRoleEnum
    content?: string | ClaudeMessageContentBlockParam[]
}

type ClaudeDeltaResponseType =
    | 'content_block_delta'
    | 'content_block_start'
    | 'message_start'

type ResponsePayload<T extends ClaudeDeltaResponseType> = {
    content_block_delta: {
        type: string
        text: string
        partial_json?: string
        thinking?: string
    }
    content_block_start: {
        type: string
        id: string
        name: string
        input: object
        text?: string
    }
    message_start: {
        id: string
        type: string
        role: string
        model: string
        stop_sequence?: string
    }
}[T]

type PayloadMapping = {
    content_block_delta: { delta: ResponsePayload<'content_block_delta'> }
    content_block_start: {
        content_block: ResponsePayload<'content_block_start'>
    }
    message_start: { message: ResponsePayload<'message_start'> }
}

export type ClaudeDeltaResponse = {
    [T in ClaudeDeltaResponseType]: {
        type: T
        index: number
    } & PayloadMapping[T]
}[ClaudeDeltaResponseType]

export type ChatCompletionResponseMessageRoleEnum =
    | 'system'
    | 'assistant'
    | 'user'
    | 'tool'

export interface ClaudeModelInfo {
    id: string
    created_at: string
    display_name: string
    type: 'model'
}

export interface ClaudeListModelsResponse {
    data: ClaudeModelInfo[]
    first_id?: string
    has_more?: boolean
    last_id?: string
}
