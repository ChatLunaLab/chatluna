import {
    AIMessage,
    AIMessageChunk,
    BaseMessage,
    ChatMessageChunk,
    FunctionMessageChunk,
    HumanMessageChunk,
    MessageContentComplex,
    MessageContentImageUrl,
    MessageType,
    SystemMessageChunk,
    ToolMessage,
    ToolMessageChunk,
    type UsageMetadata
} from '@langchain/core/messages'
import { StructuredTool } from '@langchain/core/tools'
import { JsonSchema7Type, zodToJsonSchema } from 'zod-to-json-schema'
import {
    ChatCompletionResponseMessage,
    ChatCompletionResponseMessageRoleEnum,
    ChatCompletionTool,
    ChatCompletionUsage,
    type ResponseBuiltinTool,
    ResponseInputContent,
    ResponseInputItem,
    ResponseObject,
    ResponseOutputContent,
    ResponseOutputItem,
    ResponseTool,
    ResponseUsage
} from './types'
import { ChatLunaPlugin } from 'koishi-plugin-chatluna/services/chat'
import { logger } from 'koishi-plugin-chatluna'
import {
    getImageMimeType,
    getMimeTypeFromSource,
    isMessageContentImageUrl
} from 'koishi-plugin-chatluna/utils/string'
import {
    isChatLunaUserMessage,
    isMessageContentAudio
} from 'koishi-plugin-chatluna/utils/langchain'
import { ToolCallChunk } from '@langchain/core/messages/tool'
import { isZodSchemaV3 } from '@langchain/core/utils/types'
import {
    DEFAULT_AUDIO_MAX_BASE64_BYTES,
    normalizeOpenAIModelName,
    supportAudioInput,
    supportImageInput
} from './client'

export function createUsageMetadata(data: {
    inputTokens: number
    outputTokens: number
    totalTokens: number
    inputAudioTokens?: number
    inputImageTokens?: number
    outputAudioTokens?: number
    outputImageTokens?: number
    cacheReadTokens?: number
    cacheCreationTokens?: number
    reasoningTokens?: number
}): UsageMetadata {
    const inputTokenDetails = {
        ...(data.inputAudioTokens != null
            ? { audio: data.inputAudioTokens }
            : {}),
        ...(data.inputImageTokens != null
            ? { image: data.inputImageTokens }
            : {}),
        ...(data.cacheReadTokens != null
            ? { cache_read: data.cacheReadTokens }
            : {}),
        ...(data.cacheCreationTokens != null
            ? { cache_creation: data.cacheCreationTokens }
            : {})
    }
    const outputTokenDetails = {
        ...(data.outputAudioTokens != null
            ? { audio: data.outputAudioTokens }
            : {}),
        ...(data.outputImageTokens != null
            ? { image: data.outputImageTokens }
            : {}),
        ...(data.reasoningTokens != null
            ? { reasoning: data.reasoningTokens }
            : {})
    }

    return {
        input_tokens: data.inputTokens,
        output_tokens: data.outputTokens,
        total_tokens: data.totalTokens,
        ...(Object.keys(inputTokenDetails).length > 0
            ? { input_token_details: inputTokenDetails }
            : {}),
        ...(Object.keys(outputTokenDetails).length > 0
            ? { output_token_details: outputTokenDetails }
            : {})
    }
}

export function openAIUsageToUsageMetadata(
    usage: ChatCompletionUsage
): UsageMetadata {
    return createUsageMetadata({
        inputTokens: usage.prompt_tokens,
        outputTokens: usage.completion_tokens,
        totalTokens: usage.total_tokens,
        inputAudioTokens: usage.prompt_tokens_details?.audio_tokens,
        outputAudioTokens: usage.completion_tokens_details?.audio_tokens,
        cacheReadTokens: usage.prompt_tokens_details?.cached_tokens,
        reasoningTokens: usage.completion_tokens_details?.reasoning_tokens
    })
}

export function openAIResponseUsageToUsageMetadata(
    usage: ResponseUsage
): UsageMetadata {
    return createUsageMetadata({
        inputTokens: usage.input_tokens,
        outputTokens: usage.output_tokens,
        totalTokens: usage.total_tokens,
        cacheReadTokens: usage.input_tokens_details?.cached_tokens,
        reasoningTokens: usage.output_tokens_details?.reasoning_tokens
    })
}

export async function langchainMessageToResponseInput(
    messages: BaseMessage[],
    plugin: ChatLunaPlugin,
    model?: string,
    supportImageInputType?: boolean
): Promise<ResponseInputItem[]> {
    const chatMessages = await langchainMessageToOpenAIMessage(
        messages,
        plugin,
        model,
        supportImageInputType
    )
    const result: ResponseInputItem[] = []

    for (const msg of chatMessages) {
        if (msg.role === 'tool') {
            result.push({
                type: 'function_call_output',
                call_id: msg.tool_call_id,
                output: responseInputContent(msg.content)
            })
            continue
        }

        if (msg.role === 'function') {
            result.push({
                type: 'message',
                role: 'user',
                content: responseInputContent(msg.content)
            })
            continue
        }

        if (msg.content != null && msg.content !== '') {
            result.push({
                type: 'message',
                role:
                    msg.role === 'system' ||
                    msg.role === 'assistant' ||
                    msg.role === 'user'
                        ? msg.role
                        : 'user',
                content: responseInputContent(msg.content)
            })
        }

        if (msg.role !== 'assistant' || !Array.isArray(msg.tool_calls)) {
            continue
        }

        result.push(
            ...msg.tool_calls.map((toolCall) => ({
                type: 'function_call' as const,
                call_id: toolCall.id,
                name: toolCall.function.name,
                arguments: toolCall.function.arguments,
                status: 'completed' as const
            }))
        )
    }

    return result
}

export function responseInputContent(
    content: ChatCompletionResponseMessage['content']
): string | ResponseInputContent[] {
    if (typeof content === 'string') return content
    if (!Array.isArray(content)) return ''

    return content
        .map((part) => {
            if (part.type === 'text') {
                const text = part.text as string
                return {
                    type: 'input_text',
                    text
                } satisfies ResponseInputContent
            }

            if (part.type === 'image_url') {
                const raw = part.image_url as
                    | string
                    | { url: string; detail?: 'low' | 'high' }
                const imageUrl = typeof raw === 'string' ? raw : raw.url
                const detail = typeof raw === 'string' ? undefined : raw.detail

                return {
                    type: 'input_image',
                    image_url: imageUrl,
                    detail: detail ?? 'auto'
                } satisfies ResponseInputContent
            }

            if (part.type === 'file_url') {
                const raw = part['file_url'] as
                    | string
                    | { url: string; filename?: string }
                return {
                    type: 'input_file',
                    file_url: typeof raw === 'string' ? raw : raw.url,
                    filename: typeof raw === 'string' ? undefined : raw.filename
                } satisfies ResponseInputContent
            }

            // OpenAI Response API does not accept `input_audio` yet — drop it.
            return undefined
        })
        .filter((part) => part != null)
}

export function formatToolsToResponseTools(
    tools: StructuredTool[],
    includeGoogleSearch: boolean,
    builtinTools: ResponseBuiltinTool[] = []
): ResponseTool[] | undefined {
    const result: ResponseTool[] = (
        formatToolsToOpenAITools(tools, includeGoogleSearch) ?? []
    ).map((tool) => {
        if (tool.function.name === 'googleSearch') {
            return {
                type: 'web_search' as const
            }
        }

        return {
            type: 'function' as const,
            name: tool.function.name,
            description: tool.function.description,
            parameters: tool.function.parameters
        }
    })

    for (const tool of builtinTools) {
        if (result.some((item) => item.type === tool.type)) continue
        result.push(tool)
    }

    return result.length ? result : undefined
}

export function responseOutputText(response: ResponseObject): string {
    if ((response.output_text?.length ?? 0) > 0) return response.output_text

    return (response.output ?? [])
        .flatMap((item) => {
            if (item.type !== 'message') return []
            return ((item.content ?? []) as ResponseOutputContent[]).map(
                (part) => {
                    if (part.type === 'output_text') return part.text
                    if (part.type === 'refusal') return part.refusal
                    return ''
                }
            )
        })
        .join('')
}

export function responseOutputToolCalls(response: ResponseObject) {
    return (response.output ?? []).filter(
        (
            item
        ): item is Extract<ResponseOutputItem, { type: 'function_call' }> =>
            item.type === 'function_call'
    )
}

export function responseOutputImageItems(response: ResponseObject) {
    return (response.output ?? [])
        .filter((item) => item.type === 'image_generation_call' && item.result)
        .map(
            (item) =>
                item as Extract<
                    ResponseOutputItem,
                    { type: 'image_generation_call' }
                >
        )
}

export async function langchainMessageToOpenAIMessage(
    messages: BaseMessage[],
    plugin: ChatLunaPlugin,
    model?: string,
    supportImageInputType?: boolean,
    removeSystemMessage?: boolean
): Promise<ChatCompletionResponseMessage[]> {
    const result: ChatCompletionResponseMessage[] = []

    const normalizedModel = model ? normalizeOpenAIModelName(model) : model
    for (const rawMessage of messages) {
        const role = messageTypeToOpenAIRole(rawMessage.getType())

        const msg = {
            content: rawMessage.content === '' ? null : rawMessage.content,
            name:
                role === 'assistant' || role === 'tool'
                    ? rawMessage.name
                    : undefined,
            role,
            //  function_call: rawMessage.additional_kwargs.function_call,

            tool_call_id: (rawMessage as ToolMessage).tool_call_id || undefined
        } as ChatCompletionResponseMessage

        if (msg.tool_calls == null) {
            delete msg.tool_calls
        }

        if (msg.tool_call_id == null) {
            delete msg.tool_call_id
        }

        if (rawMessage.getType() === 'ai') {
            const toolCalls = (rawMessage as AIMessage).tool_calls

            if (Array.isArray(toolCalls) && toolCalls.length > 0) {
                msg.tool_calls = toolCalls.map((toolCall) => ({
                    id: toolCall.id,
                    type: 'function',
                    function: {
                        name: toolCall.name,
                        arguments: JSON.stringify(toolCall.args)
                    }
                }))
            }
        }

        if (rawMessage.additional_kwargs.images != null) {
            logger.warn(
                'Deprecated: `additional_kwargs.images` is no longer supported. Use `image_url` content parts instead.'
            )
        }

        if (Array.isArray(msg.content) && msg.content.length > 0) {
            const supportsAudio = supportAudioInput(normalizedModel ?? '')
            const supportsImage =
                supportImageInput(normalizedModel ?? '') ||
                supportImageInputType === true
            const mappedContent = await Promise.all(
                msg.content.map(async (content) => {
                    if (isMessageContentImageUrl(content)) {
                        if (!supportsImage) {
                            logger.warn(
                                `Model ${normalizedModel} does not accept image input; dropping image content.`
                            )
                            return null
                        }
                        try {
                            const url = await fetchImageUrl(plugin, content)
                            return {
                                type: 'image_url',
                                image_url: { url, detail: 'low' }
                            }
                        } catch {
                            return null
                        }
                    }

                    if (isMessageContentAudio(content)) {
                        if (!supportsAudio) {
                            logger.warn(
                                `Model ${normalizedModel} does not accept audio input; dropping audio content.`
                            )
                            return null
                        }
                        try {
                            return await fetchAudioContentPart(plugin, content)
                        } catch {
                            return null
                        }
                    }

                    return content
                })
            )

            msg.content = mappedContent.filter(
                (content) => content != null
            ) as ChatCompletionResponseMessage['content']
        }

        result.push(msg)
    }

    // Fix missing tool_call_ids: match assistant tool_calls with following tool messages
    for (let i = 0; i < result.length; i++) {
        if (result[i].role !== 'assistant') continue

        const assistantMsg = result[i]
        const toolMessages: ChatCompletionResponseMessage[] = []

        for (
            let j = i + 1;
            j < result.length && result[j].role === 'tool';
            j++
        ) {
            toolMessages.push(result[j])
        }

        if (toolMessages.length === 0) continue

        if (!assistantMsg.tool_calls) {
            assistantMsg.tool_calls = []
        }

        for (let k = 0; k < toolMessages.length; k++) {
            if (!assistantMsg.tool_calls[k]) {
                assistantMsg.tool_calls[k] = {
                    id: `call_${k}`,
                    type: 'function',
                    function: {
                        name: toolMessages[k].name || 'unknown',
                        arguments: '{}'
                    }
                }
            }

            if (!assistantMsg.tool_calls[k].id) {
                assistantMsg.tool_calls[k].id = `call_${k}`
            }

            if (!toolMessages[k].tool_call_id) {
                toolMessages[k].tool_call_id = assistantMsg.tool_calls[k].id
            }
        }
    }

    if (removeSystemMessage) {
        return transformSystemMessages(result)
    }

    return processInterleavedThinkMessages(result, messages)
}

export function processInterleavedThinkMessages(
    convertedMessages: ChatCompletionResponseMessage[],
    originalMessages: BaseMessage[]
): ChatCompletionResponseMessage[] {
    if (originalMessages.length === 0) {
        return convertedMessages
    }

    const hasToolCallRound = convertedMessages.some(
        (message) =>
            message.role === 'assistant' &&
            (message.tool_calls?.length ?? 0) > 0
    )

    // Find the start of the last turn by locating the last ChatLuna user message.
    let lastTurnStartIndex = -1
    for (let i = originalMessages.length - 1; i >= 0; i--) {
        const message = originalMessages[i]
        if (isChatLunaUserMessage(message)) {
            lastTurnStartIndex = i
            break
        }
    }

    if (lastTurnStartIndex === -1) {
        for (let i = originalMessages.length - 1; i >= 0; i--) {
            const message = originalMessages[i]
            if (message.getType() === 'human') {
                lastTurnStartIndex = i
                break
            }
        }
    }

    if (lastTurnStartIndex === -1) {
        lastTurnStartIndex = 0
    }

    // For messages in the last turn, add reasoning_content from additional_kwargs
    return convertedMessages.map((message, index) => {
        if (hasToolCallRound || index >= lastTurnStartIndex) {
            const originalMessage = originalMessages[index]
            const reasoningContent = originalMessage?.additional_kwargs
                ?.reasoning_content as string | undefined

            // DeepSeek-V4 thinking mode requires the original reasoning_content
            // (including empty string) to be passed back. Keep "" as-is.
            if (reasoningContent != null) {
                return {
                    ...message,
                    reasoning_content: reasoningContent
                }
            }
        }
        return message
    })
}

export function transformSystemMessages(
    messages: ChatCompletionResponseMessage[]
): ChatCompletionResponseMessage[] {
    const mappedMessage: ChatCompletionResponseMessage[] = []

    for (let i = 0; i < messages.length; i++) {
        const message = messages[i]

        if (message.role !== 'system') {
            mappedMessage.push(message)
            continue
        }

        // Skip system messages (remove them)
        continue
    }

    // Ensure the conversation doesn't end with an assistant message
    if (mappedMessage[mappedMessage.length - 1]?.role === 'assistant') {
        mappedMessage.push({
            role: 'user',
            content:
                'Continue what I said to you last message. Follow these instructions.'
        })
    }

    // Ensure the conversation doesn't start with an assistant message
    if (mappedMessage[0]?.role === 'assistant') {
        mappedMessage.unshift({
            role: 'user',
            content:
                'Continue what I said to you last time. Follow these instructions.'
        })
    }

    return mappedMessage
}

export async function fetchImageUrl(
    plugin: ChatLunaPlugin,
    content: MessageContentImageUrl
) {
    const url =
        typeof content.image_url === 'string'
            ? content.image_url
            : content.image_url.url

    if (url.includes('data:image') && url.includes('base64')) {
        return url
    }

    const ext = url.match(/\.([^.?#]+)(?:[?#]|$)/)?.[1]?.toLowerCase()
    const imageType = getImageMimeType(ext)
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 60_000)
    const response = await plugin
        .fetch(url, {
            signal: controller.signal
        })
        .finally(() => {
            clearTimeout(timeout)
        })

    if (!response.ok) {
        throw new Error(`Failed to fetch image: ${response.status}`)
    }

    const buffer = Buffer.from(await response.arrayBuffer())

    return `data:${imageType};base64,${buffer.toString('base64')}`
}

type MessageContentFileLike = MessageContentComplex &
    (
        | {
              type: 'file_url'
              file_url: string | { url: string; mimeType?: string }
          }
        | {
              type: 'audio_url'
              audio_url: string | { url: string; mimeType?: string }
          }
        | {
              type: 'video_url'
              video_url: string | { url: string; mimeType?: string }
          }
    )

function getFileLikeUrlInfo(content: MessageContentFileLike) {
    switch (content.type) {
        case 'file_url': {
            const raw = content.file_url
            return {
                url: typeof raw === 'string' ? raw : raw.url,
                mimeType: typeof raw === 'string' ? undefined : raw.mimeType
            }
        }
        case 'audio_url': {
            const raw = content.audio_url
            return {
                url: typeof raw === 'string' ? raw : raw.url,
                mimeType: typeof raw === 'string' ? undefined : raw.mimeType
            }
        }
        case 'video_url': {
            const raw = content.video_url
            return {
                url: typeof raw === 'string' ? raw : raw.url,
                mimeType: typeof raw === 'string' ? undefined : raw.mimeType
            }
        }
    }
}

/**
 * Fetch file/audio/video content and return decoded bytes.
 * If the source is a base64 data URL, it is decoded directly.
 */
export async function fetchFileLikeUrl(
    plugin: ChatLunaPlugin,
    content: MessageContentFileLike
) {
    const { url, mimeType } = getFileLikeUrlInfo(content)
    const dataUrlMatch = url.match(/^data:([^;,]+);base64,(.+)$/i)

    if (dataUrlMatch) {
        return {
            buffer: Buffer.from(dataUrlMatch[2], 'base64'),
            mimeType: dataUrlMatch[1] || mimeType || 'application/octet-stream'
        }
    }

    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 60_000)
    const response = await plugin
        .fetch(url, {
            signal: controller.signal
        })
        .finally(() => {
            clearTimeout(timeout)
        })

    if (!response.ok) {
        throw new Error(`Failed to fetch file: ${response.status}`)
    }

    const buffer = Buffer.from(await response.arrayBuffer())
    const fetchedMimeType = response.headers
        .get('content-type')
        ?.split(';')[0]
        ?.trim()

    return {
        buffer,
        mimeType:
            mimeType ??
            fetchedMimeType ??
            getMimeTypeFromSource(url) ??
            'application/octet-stream'
    }
}

const AUDIO_MIME_TO_FORMAT: Record<string, string> = {
    'audio/mpeg': 'mp3',
    'audio/mp3': 'mp3',
    'audio/wav': 'wav',
    'audio/x-wav': 'wav',
    'audio/flac': 'flac',
    'audio/x-flac': 'flac',
    'audio/ogg': 'ogg',
    'audio/mp4': 'mp4',
    'audio/aac': 'aac',
    'audio/webm': 'webm'
}

function audioMimeToFormat(mime: string): string {
    return AUDIO_MIME_TO_FORMAT[mime.toLowerCase()] ?? 'mp3'
}

/**
 * Fetch an `audio_url` content part and convert it to the OpenAI-compatible
 * `input_audio` shape used by gpt-4o-audio / MiMo. Returns `null` when the
 * encoded payload exceeds {@link DEFAULT_AUDIO_MAX_BASE64_BYTES}.
 */
async function fetchAudioContentPart(
    plugin: ChatLunaPlugin,
    content: MessageContentFileLike & { type: 'audio_url' }
): Promise<MessageContentComplex | null> {
    const { buffer, mimeType } = await fetchFileLikeUrl(plugin, content)
    const base64 = buffer.toString('base64')

    if (base64.length > DEFAULT_AUDIO_MAX_BASE64_BYTES) {
        return null
    }

    return {
        type: 'input_audio',
        input_audio: {
            data: base64,
            format: audioMimeToFormat(mimeType)
        }
    } as unknown as MessageContentComplex
}

export function messageTypeToOpenAIRole(
    type: MessageType
): ChatCompletionResponseMessageRoleEnum {
    switch (type) {
        case 'system':
            return 'system'
        case 'ai':
            return 'assistant'
        case 'human':
            return 'user'
        case 'function':
            return 'function'
        case 'tool':
            return 'tool'
        default:
            throw new Error(`Unknown message type: ${type}`)
    }
}

export function formatToolsToOpenAITools(
    tools: StructuredTool[],
    includeGoogleSearch: boolean
): ChatCompletionTool[] {
    const result = tools.map(formatToolToOpenAITool)

    if (includeGoogleSearch) {
        result.push({
            type: 'function',
            function: {
                name: 'googleSearch'
            }
        })
    }

    if (result.length < 1) {
        return undefined
    }

    return result
}

export function formatToolToOpenAITool(
    tool: StructuredTool
): ChatCompletionTool {
    const parameters = removeAdditionalProperties(
        isZodSchemaV3(tool.schema)
            ? zodToJsonSchema(tool.schema as never, {
                  allowedAdditionalProperties: undefined
              })
            : tool.schema
    )

    return {
        type: 'function',
        function: {
            name: tool.name,
            description: tool.description,
            // any?
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            parameters
        }
    }
}

export function removeAdditionalProperties(
    schema: JsonSchema7Type
): JsonSchema7Type {
    if (!schema || typeof schema !== 'object') return schema

    const stack: [JsonSchema7Type, string | null][] = [[schema, null]]

    while (stack.length > 0) {
        const [current] = stack.pop()

        if (typeof current !== 'object' || current === null) continue

        // Remove additionalProperties and $schema
        if (Object.hasOwn(current, 'additionalProperties')) {
            delete current['additionalProperties']
        }

        if (Object.hasOwn(current, '$schema')) {
            delete current['$schema']
        }

        // Convert const to enum for Gemini/Vertex AI compatibility
        // const: X is semantically equivalent to enum: [X] per JSON Schema spec
        if (Object.hasOwn(current, 'const')) {
            if (!Object.hasOwn(current, 'enum')) {
                current['enum'] = [current['const']]
            }
            delete current['const']
        }

        // Process all keys in the object
        for (const key of Object.keys(current)) {
            const value = current[key]
            if (value && typeof value === 'object') {
                stack.push([value, key])
            }
        }
    }

    return schema
}

export function convertMessageToMessageChunk(
    message: ChatCompletionResponseMessage
) {
    const content = message.content ?? ''
    const reasoningContent = message.reasoning_content

    const role = (
        (message.role?.length ?? 0) > 0 ? message.role : 'assistant'
    ).toLowerCase()

    const additionalKwargs: {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/naming-convention
        function_call?: any
        // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/naming-convention
        tool_calls?: any
        reasoning_content?: string
    } = {}

    // Preserve empty reasoning_content for DeepSeek-V4 thinking mode.
    if (reasoningContent != null) {
        additionalKwargs.reasoning_content = reasoningContent
    }

    if (role === 'user') {
        return new HumanMessageChunk({ content })
    } else if (role === 'assistant') {
        const toolCallChunks: ToolCallChunk[] = []
        if (Array.isArray(message.tool_calls)) {
            for (const rawToolCall of message.tool_calls) {
                let name = rawToolCall.function?.name

                if (name != null && name.length < 1) {
                    name = undefined
                }
                toolCallChunks.push({
                    name,
                    args: rawToolCall.function?.arguments,
                    id: rawToolCall.id
                })
            }
        }
        return new AIMessageChunk({
            content,
            tool_call_chunks: toolCallChunks,
            additional_kwargs: additionalKwargs
        })
    } else if (role === 'system') {
        return new SystemMessageChunk({ content })
    } else if (role === 'function') {
        return new FunctionMessageChunk({
            content,
            additional_kwargs: additionalKwargs,
            name: message.name
        })
    } else if (role === 'tool') {
        return new ToolMessageChunk({
            content,
            additional_kwargs: additionalKwargs,
            tool_call_id: message.tool_call_id
        })
    } else {
        return new ChatMessageChunk({ content, role })
    }
}

export function convertDeltaToMessageChunk(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    delta: Record<string, any>,
    defaultRole?: ChatCompletionResponseMessageRoleEnum
) {
    const role = (
        (delta.role?.length ?? 0) > 0 ? delta.role : defaultRole
    ).toLowerCase()
    const content = delta.content ?? ''
    const reasoningContent = delta.reasoning_content as string | undefined

    let additionalKwargs: {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/naming-convention
        function_call?: any
        reasoning_content?: string
    }
    if (delta.function_call) {
        additionalKwargs = {
            function_call: delta.function_call
        }
    } else {
        additionalKwargs = {}
    }

    // Preserve empty reasoning_content for DeepSeek-V4 thinking mode.
    if (reasoningContent != null) {
        additionalKwargs.reasoning_content = reasoningContent
    }

    if (role === 'user') {
        return new HumanMessageChunk({ content })
    } else if (role === 'assistant') {
        const toolCallChunks = []
        if (Array.isArray(delta.tool_calls)) {
            for (const rawToolCall of delta.tool_calls) {
                const toolCall = {
                    name: rawToolCall.function?.name,
                    args: rawToolCall.function?.arguments,
                    id: rawToolCall.id === '' ? undefined : rawToolCall.id,
                    index: rawToolCall.index
                }

                if (toolCall.name != null && toolCall.name.length < 1) {
                    delete toolCall.name
                }

                toolCallChunks.push(toolCall)
            }
        }

        return new AIMessageChunk({
            content,
            tool_call_chunks: toolCallChunks,
            additional_kwargs: additionalKwargs
        })
    } else if (role === 'system') {
        return new SystemMessageChunk({ content })
    } else if (role === 'function') {
        return new FunctionMessageChunk({
            content,
            additional_kwargs: additionalKwargs,
            name: delta.name
        })
    } else if (role === 'tool') {
        return new ToolMessageChunk({
            content,
            additional_kwargs: additionalKwargs,
            tool_call_id: delta.tool_call_id
        })
    } else {
        return new ChatMessageChunk({ content, role })
    }
}
