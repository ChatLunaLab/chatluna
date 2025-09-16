import {
    AIMessage,
    AIMessageChunk,
    BaseMessage,
    MessageContentComplex,
    MessageContentImageUrl,
    MessageType,
    ToolMessage
} from '@langchain/core/messages'
import {
    ChatCompletionResponseMessageRoleEnum,
    ClaudeDeltaResponse,
    ClaudeMessage,
    CluadeTool
} from './types'
import { StructuredTool } from '@langchain/core/tools'
import { zodToJsonSchema } from 'zod-to-json-schema'
import { ChatLunaPlugin } from 'koishi-plugin-chatluna/services/chat'
import { fetchImageUrl } from '@chatluna/v1-shared-adapter'
import { isMessageContentImageUrl } from 'koishi-plugin-chatluna/utils/string'
import { logger } from '.'
import { isZodSchemaV3 } from '@langchain/core/utils/types'

export async function langchainMessageToClaudeMessage(
    messages: BaseMessage[],
    plugin: ChatLunaPlugin,
    model?: string
): Promise<ClaudeMessage[]> {
    const result: ClaudeMessage[] = []

    const mappedMessages = await Promise.all(
        messages.map(async (rawMessage) => {
            const images = rawMessage.additional_kwargs.images as
                | string[]
                | null

            const result: ClaudeMessage = {
                role: messageTypeToClaudeRole(rawMessage.getType()),
                content:
                    typeof rawMessage.content === 'string'
                        ? rawMessage.content
                        : await processMessageContent(
                              plugin,
                              rawMessage.content
                          )
            }

            if (
                (model.includes('claude-3') || model.includes('claude-4')) &&
                images != null
            ) {
                result.content = []
                for (const image of images) {
                    result.content.push({
                        type: 'image',
                        source: {
                            type: 'base64',
                            media_type: 'image/jpeg',
                            // remove base64 header
                            data: image.replace(/^data:image\/\w+;base64,/, '')
                        }
                    })
                }
                result.content.push({
                    type: 'text',
                    text: rawMessage.content as string
                })
            }

            if (
                (rawMessage instanceof AIMessageChunk ||
                    rawMessage instanceof AIMessage) &&
                (rawMessage.tool_calls?.length ?? 0) > 0
            ) {
                result.content = []

                const thinkContent = rawMessage.content as string

                if ((thinkContent?.length ?? 0) > 0) {
                    result.content.push({
                        type: 'text',
                        text: thinkContent
                    })
                }

                const mapToolCalls = rawMessage.tool_calls.map((toolCall) => ({
                    type: 'tool_use' as const,
                    id: toolCall.id,
                    name: toolCall.name,
                    input: toolCall.args
                }))

                result.content.push(...mapToolCalls)
            } else if (rawMessage instanceof ToolMessage) {
                result.content = []

                result.content.push({
                    type: 'tool_result',
                    content: rawMessage.content as string,
                    tool_use_id: rawMessage.tool_call_id
                })
            }

            return result
        })
    )

    for (let i = 0; i < mappedMessages.length; i++) {
        const message = mappedMessages[i]

        if (message.role !== 'system') {
            result.push(message)
            continue
        }

        /*   if (removeSystemMessage) {
            continue
        } */

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

    if (result[result.length - 1].role === 'assistant') {
        result.push({
            role: 'user',
            content:
                'Continue what I said to you last message. Follow these instructions.'
        })
    }

    return result
}

async function processImageContent(
    plugin: ChatLunaPlugin,
    message: MessageContentImageUrl
) {
    let url: string
    try {
        url = await fetchImageUrl(plugin, message)
    } catch (e) {
        url =
            typeof message.image_url === 'string'
                ? message.image_url
                : message.image_url.url
        logger.warn(`Failed to fetch image url: ${url}`, e)
    }

    const mineType = url.match(/^data:([^;]+);base64,/)?.[1] ?? 'image/jpeg'
    const data = url.replace(/^data:image\/\w+;base64,/, '')

    return {
        type: 'image',
        source: {
            type: 'base64',
            media_type: mineType,
            data
        }
    } as const
}

async function processMessageContent(
    plugin: ChatLunaPlugin,
    content: MessageContentComplex[]
) {
    return Promise.all(
        content.map(async (message) => {
            if (message.type === 'text') {
                return {
                    type: 'text',
                    text: message.text
                } as const
            }
            if (isMessageContentImageUrl(message)) {
                return await processImageContent(plugin, message)
            }
        })
    )
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
): CluadeTool[] {
    if (tools.length < 1) {
        return undefined
    }
    return tools.map(formatToolToClaudeTool)
}

export function formatToolToClaudeTool(tool: StructuredTool): CluadeTool {
    const inputSchema = isZodSchemaV3(tool.schema)
        ? zodToJsonSchema(tool.schema as never)
        : tool.schema

    delete inputSchema['$schema']
    delete inputSchema['additionalProperties']

    return {
        name: tool.name,
        description: tool.description,
        // any?
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        input_schema: inputSchema
    }
}

export function convertDeltaToMessageChunk(delta: ClaudeDeltaResponse) {
    if (delta.type === 'message_start') {
        return new AIMessageChunk({
            content: '',
            id: delta.message.id
        })
    } else if (
        delta.type === 'content_block_start' &&
        delta.content_block.type === 'tool_use'
    ) {
        const toolCallContentBlock = delta.content_block
        return new AIMessageChunk({
            content: '',
            tool_call_chunks: [
                {
                    id: toolCallContentBlock.id,
                    index: delta.index,
                    name: toolCallContentBlock.name,
                    args: ''
                }
            ],
            additional_kwargs: {}
        })
    } else if (
        delta.type === 'content_block_delta' &&
        delta.delta.type === 'text_delta'
    ) {
        const content = delta.delta?.text
        if (content !== undefined) {
            return new AIMessageChunk({
                content
            })
        }
    } else if (
        delta.type === 'content_block_delta' &&
        delta.delta.type === 'input_json_delta'
    ) {
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
    } else if (
        delta.type === 'content_block_start' &&
        delta.content_block.type === 'text'
    ) {
        const content = delta.content_block?.text
        if (content !== undefined) {
            return new AIMessageChunk({
                content,
                additional_kwargs: {}
            })
        }
    } else if (
        delta.type === 'content_block_delta' &&
        delta.delta.type === 'thinking_delta'
    ) {
        const thinkResult = delta.delta.thinking
        return new AIMessageChunk({
            content: '',
            additional_kwargs: {
                reasoning_content: thinkResult
            }
        })
    }
}
