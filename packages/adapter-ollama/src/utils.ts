import {
    AIMessage,
    BaseMessage,
    MessageContentImageUrl,
    MessageType
} from '@langchain/core/messages'
import { StructuredTool } from '@langchain/core/tools'
import { OllamaMessage, OllamaRole, OllamaTool } from './types'
import {
    getMessageContent,
    isMessageContentImageUrl
} from 'koishi-plugin-chatluna/utils/string'
import { ChatLunaPlugin } from 'koishi-plugin-chatluna/services/chat'
import {
    fetchImageUrl,
    formatToolsToOpenAITools
} from '@chatluna/v1-shared-adapter'
import { logger } from '.'

export function formatToolsToOllamaTools(
    tools: StructuredTool[]
): OllamaTool[] | undefined {
    if (tools.length < 1) {
        return undefined
    }

    return formatToolsToOpenAITools(tools, false).map((tool) => ({
        type: 'function',
        function: {
            name: tool.function.name,
            description: tool.function.description,
            parameters: tool.function.parameters as Record<string, unknown>
        }
    }))
}

export async function langchainMessageToOllamaMessage(
    messages: BaseMessage[],
    plugin: ChatLunaPlugin,
    supportImage: boolean
): Promise<OllamaMessage[]> {
    const result: OllamaMessage[] = []

    for (const rawMessage of messages) {
        if (rawMessage.additional_kwargs.images != null) {
            logger.warn(
                'Deprecated: `additional_kwargs.images` is no longer supported. Use `image_url` content parts instead.'
            )
        }

        const images: string[] | undefined = supportImage
            ? typeof rawMessage.content === 'string'
                ? undefined
                : await Promise.all(
                      rawMessage.content
                          .filter((part) => isMessageContentImageUrl(part))
                          .map((part) =>
                              processOllamaImageContent(plugin, part)
                          )
                  )
            : undefined

        const msg: OllamaMessage = {
            role: messageTypeToOllamaRole(rawMessage.getType()),
            content: getMessageContent(rawMessage.content),
            images: images?.filter((image): image is string => image != null)
        }

        if (msg.images == null) {
            delete msg.images
        } else if (msg.images.length === 0) {
            delete msg.images
        } else {
            msg.images = msg.images.map((image) =>
                image.replace(/^data:image\/\w+;base64,/, '')
            )
        }

        if (rawMessage.getType() === 'ai') {
            const toolCalls = (rawMessage as AIMessage).tool_calls
            const thinking = rawMessage.additional_kwargs.reasoning_content as
                | string
                | undefined

            if (thinking != null) {
                msg.thinking = thinking
            }

            if (Array.isArray(toolCalls) && toolCalls.length > 0) {
                msg.tool_calls = toolCalls.map((toolCall, index) => ({
                    type: 'function',
                    function: {
                        index,
                        name: toolCall.name,
                        arguments: toolCall.args
                    }
                }))
            }
        }

        if (msg.role === 'tool') {
            msg.tool_name = rawMessage.name
        }

        result.push(msg)
    }

    for (let i = 0; i < result.length; i++) {
        if (result[i].role !== 'assistant') continue

        const calls = result[i].tool_calls
        if (calls == null) continue

        for (
            let j = i + 1;
            j < result.length && result[j].role === 'tool';
            j++
        ) {
            const call = calls[j - i - 1]
            if (result[j].tool_name == null && call != null) {
                result[j].tool_name = call.function.name
            }
        }
    }

    return result
}

async function processOllamaImageContent(
    plugin: ChatLunaPlugin,
    part: MessageContentImageUrl
) {
    let url: string
    try {
        url = await fetchImageUrl(plugin, part)
    } catch (e) {
        const rawUrl =
            typeof part.image_url === 'string'
                ? part.image_url
                : part.image_url.url
        logger.warn(`Failed to fetch image url: ${rawUrl}`, e)
        return null
    }

    return url
}

export function messageTypeToOllamaRole(type: MessageType): OllamaRole {
    switch (type) {
        case 'system':
            return 'system'
        case 'ai':
            return 'assistant'
        case 'human':
            return 'user'
        case 'function':
        case 'tool':
            return 'tool'
        default:
            throw new Error(`Unknown message type: ${type}`)
    }
}
