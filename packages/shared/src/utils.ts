import {
    AIMessage,
    AIMessageChunk,
    BaseMessage,
    ChatMessageChunk,
    FunctionMessageChunk,
    HumanMessageChunk,
    MessageContentImageUrl,
    MessageType,
    SystemMessageChunk,
    ToolMessage,
    ToolMessageChunk
} from '@langchain/core/messages'
import { StructuredTool } from '@langchain/core/tools'
import { JsonSchema7Type, zodToJsonSchema } from 'zod-to-json-schema'
import {
    ChatCompletionResponseMessage,
    ChatCompletionResponseMessageRoleEnum,
    ChatCompletionTool
} from './types'
import { ChatLunaPlugin } from 'koishi-plugin-chatluna/services/chat'
import {
    getImageMimeType,
    isMessageContentImageUrl
} from 'koishi-plugin-chatluna/utils/string'
import { ToolCallChunk } from '@langchain/core/messages/tool'
import { isZodSchemaV3 } from '@langchain/core/utils/types'

export async function langchainMessageToOpenAIMessage(
    messages: BaseMessage[],
    plugin: ChatLunaPlugin,
    model?: string,
    supportImageInput?: boolean,
    removeSystemMessage?: boolean
): Promise<ChatCompletionResponseMessage[]> {
    const result: ChatCompletionResponseMessage[] = []

    for (const rawMessage of messages) {
        const role = messageTypeToOpenAIRole(rawMessage.getType())

        const msg = {
            content: rawMessage.content,
            name:
                role === 'assistant' || role === 'tool'
                    ? rawMessage.name
                    : undefined,
            role,
            //  function_call: rawMessage.additional_kwargs.function_call,

            tool_call_id: (rawMessage as ToolMessage).tool_call_id
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

        const images = rawMessage.additional_kwargs.images as string[] | null

        const lowerModel = model?.toLowerCase() ?? ''
        if (
            (lowerModel?.includes('vision') ||
                lowerModel?.includes('gpt-4o') ||
                lowerModel?.includes('claude') ||
                lowerModel?.includes('gemini') ||
                lowerModel?.includes('qwen-vl') ||
                lowerModel?.includes('omni') ||
                lowerModel?.includes('qwen2.5-vl') ||
                lowerModel?.includes('qwen2.5-omni') ||
                lowerModel?.includes('qwen-omni') ||
                lowerModel?.includes('qwen2-vl') ||
                lowerModel?.includes('qvq') ||
                model?.includes('o1') ||
                model?.includes('o4') ||
                model?.includes('o3') ||
                model?.includes('gpt-4.1') ||
                model?.includes('gpt-5') ||
                supportImageInput) &&
            images != null
        ) {
            msg.content = [
                {
                    type: 'text',
                    text: rawMessage.content as string
                }
            ]

            for (const image of images) {
                msg.content.push({
                    type: 'image_url',
                    image_url: {
                        url: image,
                        detail: 'low'
                    }
                })
            }
        } else if (Array.isArray(msg.content) && msg.content.length > 0) {
            msg.content = await Promise.all(
                msg.content.map(async (content) => {
                    if (!isMessageContentImageUrl(content)) return content

                    try {
                        const url = await fetchImageUrl(plugin, content)
                        return {
                            type: 'image_url',
                            image_url: {
                                url,
                                detail: 'low'
                            }
                        }
                    } catch {
                        return content
                    }
                })
            )
        }

        result.push(msg)
    }

    if (removeSystemMessage) {
        const mappedMessage: ChatCompletionResponseMessage[] = []

        for (let i = 0; i < mappedMessage.length; i++) {
            const message = mappedMessage[i]

            if (message.role !== 'system') {
                mappedMessage.push(message)
                continue
            }

            if (removeSystemMessage) {
                continue
            }

            mappedMessage.push({
                role: 'user',
                content: message.content
            })

            mappedMessage.push({
                role: 'assistant',
                content: 'Okay, what do I need to do?'
            })

            if (mappedMessage?.[i + 1]?.role === 'assistant') {
                mappedMessage.push({
                    role: 'user',
                    content:
                        'Continue what I said to you last message. Follow these instructions.'
                })
            }
        }

        if (mappedMessage[mappedMessage.length - 1].role === 'assistant') {
            mappedMessage.push({
                role: 'user',
                content:
                    'Continue what I said to you last message. Follow these instructions.'
            })
        }

        if (mappedMessage[0].role === 'assistant') {
            mappedMessage.unshift({
                role: 'user',
                content:
                    'Continue what I said to you last time. Follow these instructions.'
            })
        }

        return mappedMessage
    }

    return result
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
    const buffer = await plugin
        .fetch(url)
        .then((res) => res.arrayBuffer())
        .then(Buffer.from)

    return `data:${imageType};base64,${buffer.toString('base64')}`
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
    const reasoningContent = message.reasoning_content ?? ''

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

    if (reasoningContent.length > 0) {
        additionalKwargs.reasoning_content = reasoningContent
    }

    if (role === 'user') {
        return new HumanMessageChunk({ content })
    } else if (role === 'assistant') {
        const toolCallChunks: ToolCallChunk[] = []
        if (Array.isArray(message.tool_calls)) {
            for (const rawToolCall of message.tool_calls) {
                toolCallChunks.push({
                    name: rawToolCall.function?.name,
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
    const reasoningContent = delta.reasoning_content ?? ''

    let additionalKwargs: {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/naming-convention
        function_call?: any
        // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/naming-convention
        tool_calls?: any
        reasoning_content?: string
    }
    if (delta.function_call) {
        additionalKwargs = {
            function_call: delta.function_call
        }
    } else if (delta.tool_calls) {
        additionalKwargs = {
            tool_calls: delta.tool_calls
        }
    } else {
        additionalKwargs = {}
    }

    if (reasoningContent.length > 0) {
        additionalKwargs.reasoning_content = reasoningContent
    }

    if (role === 'user') {
        return new HumanMessageChunk({ content })
    } else if (role === 'assistant') {
        const toolCallChunks = []
        if (Array.isArray(delta.tool_calls)) {
            for (const rawToolCall of delta.tool_calls) {
                toolCallChunks.push({
                    name: rawToolCall.function?.name,
                    args: rawToolCall.function?.arguments,
                    id: rawToolCall.id,
                    index: rawToolCall.index
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
