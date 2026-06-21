import {
    AIMessage,
    AIMessageChunk,
    BaseMessage,
    MessageContentComplex,
    MessageContentImageUrl,
    MessageType,
    ToolMessage
} from '@langchain/core/messages'
import { StructuredTool } from '@langchain/core/tools'
import { isZodSchemaV3 } from '@langchain/core/utils/types'
import { zodToJsonSchema } from 'zod-to-json-schema'
import { ChatLunaPlugin } from 'koishi-plugin-chatluna/services/chat'
import { isMessageContentImageUrl } from 'koishi-plugin-chatluna/utils/string'
import {
    fetchFileLikeUrl,
    fetchImageUrl,
    removeAdditionalProperties
} from '@chatluna/v1-shared-adapter'
import { logger } from '.'
import {
    ChatCompletionResponseMessageRoleEnum,
    ClaudeDeltaResponse,
    ClaudeInputContentBlockParam,
    ClaudeMessage,
    ClaudeMessageContentBlockParam,
    ClaudeReasoningBlockParam,
    ClaudeTool,
    ClaudeToolResultContentBlockParam,
    MessageContentFile
} from './types'

type ClaudeInlineDataContent = MessageContentComplex & {
    inline_data: {
        mime_type: string
        data: string
    }
}

function isClaudeInlineDataContent(
    message: MessageContentComplex
): message is ClaudeInlineDataContent {
    return (
        message != null &&
        typeof message === 'object' &&
        'inline_data' in message
    )
}

export async function langchainMessageToClaudeMessage(
    messages: BaseMessage[],
    plugin: ChatLunaPlugin,
    model?: string
): Promise<ClaudeMessage[]> {
    const result: ClaudeMessage[] = []

    const mappedMessages = await Promise.all(
        messages.map(async (rawMessage) => {
            const content: string | ClaudeInputContentBlockParam[] | undefined =
                typeof rawMessage.content === 'string'
                    ? rawMessage.content
                    : await processMessageContent(plugin, rawMessage.content)

            if (rawMessage.additional_kwargs.images != null) {
                logger.warn(
                    'Deprecated: `additional_kwargs.images` is no longer supported. Use `image_url` content parts instead.'
                )
            }

            const result: ClaudeMessage = {
                role: messageTypeToClaudeRole(rawMessage.getType()),
                content
            }

            if (rawMessage instanceof ToolMessage) {
                result.content = [
                    {
                        type: 'tool_result',
                        content: result.content as
                            | string
                            | ClaudeToolResultContentBlockParam[]
                            | undefined,
                        tool_use_id: rawMessage.tool_call_id
                    }
                ]
                return result
            }

            if (
                rawMessage instanceof AIMessageChunk ||
                rawMessage instanceof AIMessage
            ) {
                const blocks: ClaudeMessageContentBlockParam[] = []
                const reasoningBlocks = rawMessage.additional_kwargs
                    .reasoning_blocks as ClaudeReasoningBlockParam[] | undefined

                if (
                    Array.isArray(reasoningBlocks) &&
                    reasoningBlocks.length > 0
                ) {
                    blocks.push(...reasoningBlocks)
                } else {
                    const reasoningContent = rawMessage.additional_kwargs
                        .reasoning_content as string | undefined
                    const reasoningSignature = rawMessage.additional_kwargs
                        .reasoning_signature as string | undefined

                    if (
                        (reasoningContent?.length ?? 0) > 0 &&
                        (reasoningSignature?.length ?? 0) > 0
                    ) {
                        blocks.push({
                            type: 'thinking',
                            thinking: reasoningContent,
                            signature: reasoningSignature
                        })
                    }
                }

                if (Array.isArray(content)) {
                    blocks.push(...content)
                } else if ((content?.length ?? 0) > 0) {
                    blocks.push({
                        type: 'text',
                        text: content
                    })
                }

                if ((rawMessage.tool_calls?.length ?? 0) > 0) {
                    blocks.push(
                        ...rawMessage.tool_calls.map((toolCall) => ({
                            type: 'tool_use' as const,
                            id: toolCall.id,
                            name: toolCall.name,
                            input: toolCall.args
                        }))
                    )
                }

                if (blocks.length === 0) {
                    result.content = ''
                    return result
                }

                result.content =
                    blocks.length === 1 && blocks[0].type === 'text'
                        ? blocks[0].text
                        : blocks
            }

            return result
        })
    )

    for (let i = 0; i < mappedMessages.length; i++) {
        const message = mappedMessages[i]

        if (message.content == null) {
            continue
        }

        if (message.role !== 'system') {
            if (isToolResultMessage(message)) {
                const last = result[result.length - 1]
                if (isToolResultMessage(last)) {
                    ;(last.content as ClaudeMessageContentBlockParam[]).push(
                        ...(message.content as ClaudeMessageContentBlockParam[])
                    )
                    continue
                }
            }

            result.push(message)
            continue
        }

        result.push({
            role: 'user',
            content: message.content
        })

        if (mappedMessages?.[i + 1]?.role === 'assistant') {
            continue
        }

        if (mappedMessages?.[i + 1]?.role === 'user') {
            result.push({
                role: 'assistant',
                content: 'Okay, what do I need to do?'
            })
        }
    }

    if (result.length > 0 && result[result.length - 1].role === 'assistant') {
        result.push({
            role: 'user',
            content:
                'Continue what I said to you last message. Follow these instructions.'
        })
    }

    return result
}

function isToolResultMessage(message: ClaudeMessage) {
    return (
        message.role === 'user' &&
        Array.isArray(message.content) &&
        message.content.length > 0 &&
        message.content.every((item) => item.type === 'tool_result')
    )
}

async function processImageContent(
    plugin: ChatLunaPlugin,
    message: MessageContentImageUrl
) {
    let url: string
    try {
        url = await fetchImageUrl(plugin, message)
    } catch (e) {
        const rawUrl =
            typeof message.image_url === 'string'
                ? message.image_url
                : message.image_url.url
        logger.warn(`Failed to fetch image url: ${rawUrl}`, e)
        return null
    }

    const mimeType = url.match(/^data:([^;]+);base64,/)?.[1] ?? 'image/jpeg'
    const data = url.replace(/^data:[^;]+;base64,/, '')

    return {
        type: 'image',
        source: {
            type: 'base64',
            media_type: mimeType,
            data
        }
    } as const
}

async function processFileContent(
    plugin: ChatLunaPlugin,
    message: MessageContentFile
) {
    try {
        const { buffer, mimeType } = await fetchFileLikeUrl(plugin, message)

        if (mimeType === 'application/pdf') {
            return {
                type: 'document',
                source: {
                    type: 'base64',
                    media_type: 'application/pdf',
                    data: buffer.toString('base64')
                }
            } as const
        }

        if (mimeType.startsWith('text/') || mimeType === 'application/json') {
            return {
                type: 'document',
                source: {
                    type: 'text',
                    media_type: 'text/plain',
                    data: buffer.toString('utf8')
                }
            } as const
        }

        logger.warn(`Unsupported Claude document mime type: ${mimeType}`)
        return null
    } catch (e) {
        const rawUrl =
            typeof message.file_url === 'string'
                ? message.file_url
                : message.file_url.url
        logger.warn(`Failed to fetch file url: ${rawUrl}`, e)
        return null
    }
}

function processInlineDataContent(message: ClaudeInlineDataContent) {
    const mimeType = message.inline_data.mime_type

    if (mimeType === 'application/pdf') {
        return {
            type: 'document',
            source: {
                type: 'base64',
                media_type: 'application/pdf',
                data: message.inline_data.data
            }
        } as const
    }

    if (mimeType.startsWith('text/') || mimeType === 'application/json') {
        return {
            type: 'document',
            source: {
                type: 'text',
                media_type: 'text/plain',
                data: Buffer.from(message.inline_data.data, 'base64').toString(
                    'utf8'
                )
            }
        } as const
    }

    if (
        mimeType === 'image/jpeg' ||
        mimeType === 'image/png' ||
        mimeType === 'image/gif' ||
        mimeType === 'image/webp'
    ) {
        return {
            type: 'image',
            source: {
                type: 'base64',
                media_type: mimeType,
                data: message.inline_data.data
            }
        } as const
    }

    logger.warn(`Unsupported Claude inline mime type: ${mimeType}`)
    return null
}

async function processMessageContent(
    plugin: ChatLunaPlugin,
    content: MessageContentComplex[]
) {
    const mappedContent = await Promise.all(
        content.map(async (message) => {
            if (message.type === 'text') {
                return {
                    type: 'text',
                    text: message.text as string
                } as const
            }

            if (isMessageContentImageUrl(message)) {
                return await processImageContent(plugin, message)
            }

            if (isClaudeInlineDataContent(message)) {
                return processInlineDataContent(message)
            }

            if (message.type === 'file_url') {
                return await processFileContent(
                    plugin,
                    message as MessageContentFile
                )
            }
        })
    )

    const result: ClaudeInputContentBlockParam[] = []

    for (const message of mappedContent) {
        if (message != null) {
            result.push(message)
        }
    }

    return result
}

export function messageTypeToClaudeRole(
    type: MessageType
): ChatCompletionResponseMessageRoleEnum {
    switch (type) {
        case 'system':
            return 'system'
        case 'ai':
            return 'assistant'
        case 'human':
        case 'function':
        case 'tool':
            return 'user'
        default:
            throw new Error(`Unknown message type: ${type}`)
    }
}

export function formatToolsToClaudeTools(
    tools: StructuredTool[]
): ClaudeTool[] {
    if (tools.length < 1) {
        return []
    }

    return tools.map(formatToolToClaudeTool)
}

export function formatToolToClaudeTool(tool: StructuredTool): ClaudeTool {
    const inputSchema = removeAdditionalProperties(
        isZodSchemaV3(tool.schema)
            ? zodToJsonSchema(tool.schema as never, {
                  allowedAdditionalProperties: undefined
              })
            : tool.schema
    )

    return {
        name: tool.name,
        description: tool.description,
        input_schema: inputSchema
    }
}

export function convertDeltaToMessageChunk(delta: ClaudeDeltaResponse) {
    if (delta.type === 'message_start') {
        return new AIMessageChunk({
            content: '',
            id: delta.message.id
        })
    }

    if (delta.type === 'content_block_start') {
        if (delta.content_block.type === 'tool_use') {
            return new AIMessageChunk({
                content: '',
                tool_call_chunks: [
                    {
                        id: delta.content_block.id,
                        index: delta.index,
                        name: delta.content_block.name,
                        args: ''
                    }
                ],
                additional_kwargs: {}
            })
        }

        if (delta.content_block.type === 'text') {
            const content = delta.content_block.text
            if (content !== undefined) {
                return new AIMessageChunk({
                    content,
                    additional_kwargs: {}
                })
            }
        }

        return
    }

    if (delta.type !== 'content_block_delta') {
        return
    }

    if (delta.delta.type === 'text_delta') {
        return new AIMessageChunk({
            content: delta.delta.text
        })
    }

    if (delta.delta.type === 'input_json_delta') {
        return new AIMessageChunk({
            content: '',
            tool_call_chunks: [
                {
                    index: delta.index,
                    args: delta.delta.partial_json
                }
            ],
            additional_kwargs: {}
        })
    }

    if (delta.delta.type === 'thinking_delta') {
        return new AIMessageChunk({
            content: '',
            additional_kwargs: {
                reasoning_content: delta.delta.thinking
            }
        })
    }

    if (delta.delta.type === 'signature_delta') {
        return new AIMessageChunk({
            content: '',
            additional_kwargs: {
                reasoning_signature: delta.delta.signature
            }
        })
    }
}
