export type ClaudeThinkingConfig =
    | {
          type: 'enabled'
          budget_tokens: number
      }
    | {
          type: 'disabled'
      }
    | ({ type: 'adaptive' } & Record<string, unknown>)

export type ClaudeToolChoice =
    | { type: 'auto' }
    | { type: 'none' }
    | { type: 'any' }
    | { type: 'tool'; name: string }

export interface ClaudeRequest {
    model: string
    max_tokens: number
    temperature?: number
    top_p?: number
    top_k?: number
    stream?: boolean
    stop_sequences?: string[]
    system?: string | ClaudeTextBlockParam[]
    messages: ClaudeMessage[]
    tools?: ClaudeTool[]
    tool_choice?: ClaudeToolChoice
    thinking?: ClaudeThinkingConfig
    metadata?: Record<string, string | number | boolean>
    service_tier?: string
    [key: string]: unknown
}

export interface ClaudeTool {
    name: string
    description: string
    input_schema: object
}

export type ClaudeCacheControlEphemeral = {
    type: 'ephemeral'
    ttl?: '5m' | '1h'
}

export type ClaudeTextCitationParam =
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

export type ClaudeTextBlockParam = {
    type: 'text'
    text: string
    cache_control?: ClaudeCacheControlEphemeral
    citations?: ClaudeTextCitationParam[]
}

export type ClaudeImageSourceParam =
    | {
          type: 'base64'
          media_type: string
          data: string
      }
    | {
          type: 'url'
          url: string
      }

export type ClaudeImageBlockParam = {
    type: 'image'
    source: ClaudeImageSourceParam
    cache_control?: ClaudeCacheControlEphemeral
}

export type ClaudeContentBlockSourceContent =
    | ClaudeTextBlockParam
    | ClaudeImageBlockParam

export type ClaudeDocumentSourceParam =
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

export type ClaudeDocumentBlockParam = {
    type: 'document'
    source: ClaudeDocumentSourceParam
    cache_control?: ClaudeCacheControlEphemeral
    citations?: { enabled?: boolean }
    context?: string
    title?: string
}

export type ClaudeSearchResultBlockParam = {
    type: 'search_result'
    title: string
    source: string
    content: ClaudeTextBlockParam[]
    cache_control?: ClaudeCacheControlEphemeral
    citations?: { enabled?: boolean }
}

export type ClaudeToolUseBlockParam = {
    type: 'tool_use'
    id: string
    name: string
    input: Record<string, unknown>
    cache_control?: ClaudeCacheControlEphemeral
}

export type ClaudeToolResultContentBlockParam =
    | ClaudeTextBlockParam
    | ClaudeImageBlockParam
    | ClaudeSearchResultBlockParam
    | ClaudeDocumentBlockParam
    | {
          type: 'tool_reference'
          tool_name: string
          cache_control?: ClaudeCacheControlEphemeral
      }

export type ClaudeToolResultBlockParam = {
    type: 'tool_result'
    tool_use_id: string
    content?: string | ClaudeToolResultContentBlockParam[]
    cache_control?: ClaudeCacheControlEphemeral
    is_error?: boolean
}

export type ClaudeThinkingBlockParam = {
    type: 'thinking'
    thinking: string
    signature: string
    cache_control?: ClaudeCacheControlEphemeral
}

export type ClaudeRedactedThinkingBlockParam = {
    type: 'redacted_thinking'
    data: string
    cache_control?: ClaudeCacheControlEphemeral
}

export type ClaudeReasoningBlockParam =
    | ClaudeThinkingBlockParam
    | ClaudeRedactedThinkingBlockParam

export type ClaudeServerToolUseBlockParam = {
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

export type ClaudeServerToolResultBlockParam =
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

export type ClaudeMessageContentBlockParam =
    | ClaudeTextBlockParam
    | ClaudeImageBlockParam
    | ClaudeDocumentBlockParam
    | ClaudeSearchResultBlockParam
    | ClaudeToolUseBlockParam
    | ClaudeToolResultBlockParam
    | ClaudeReasoningBlockParam
    | ClaudeServerToolUseBlockParam
    | ClaudeServerToolResultBlockParam

export type ClaudeStreamContentBlockParam =
    | {
          type: 'text'
          text?: string
      }
    | {
          type: 'thinking'
          thinking?: string
          signature?: string
      }
    | {
          type: 'redacted_thinking'
          data?: string
      }
    | ClaudeToolUseBlockParam
    | ClaudeServerToolUseBlockParam

export interface ClaudeMessage {
    role: ChatCompletionResponseMessageRoleEnum
    content?: string | ClaudeMessageContentBlockParam[]
}

export interface ClaudeUsage {
    input_tokens: number
    output_tokens: number
    cache_creation_input_tokens?: number
    cache_read_input_tokens?: number
    [key: string]: unknown
}

export interface ClaudeResponseMessage {
    id: string
    type: string
    role: string
    content?: ClaudeMessageContentBlockParam[]
    model: string
    stop_reason?: string | null
    stop_sequence?: string | null
    usage?: ClaudeUsage
}

export type ClaudeContentBlockDelta =
    | {
          type: 'text_delta'
          text: string
      }
    | {
          type: 'input_json_delta'
          partial_json: string
      }
    | {
          type: 'thinking_delta'
          thinking: string
      }
    | {
          type: 'signature_delta'
          signature: string
      }
    | {
          type: 'citations_delta'
          citation: ClaudeTextCitationParam
      }

export type ClaudeDeltaResponse =
    | {
          type: 'content_block_delta'
          index: number
          delta: ClaudeContentBlockDelta
      }
    | {
          type: 'content_block_start'
          index: number
          content_block: ClaudeStreamContentBlockParam
      }
    | {
          type: 'content_block_stop'
          index: number
      }
    | {
          type: 'message_start'
          message: ClaudeResponseMessage
      }
    | {
          type: 'message_delta'
          delta: {
              stop_reason?: string | null
              stop_sequence?: string | null
          }
          usage?: ClaudeUsage
      }
    | {
          type: 'message_stop'
      }

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
