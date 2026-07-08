import {
    AIMessage,
    AIMessageChunk,
    BaseMessage,
    MessageContentImageUrl,
    MessageType,
    ToolMessage,
    UsageMetadata
} from '@langchain/core/messages'
import { StructuredTool } from '@langchain/core/tools'
import {
    OllamaDeltaResponse,
    OllamaMessage,
    OllamaRole,
    OllamaTool
} from './types'
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
import { ChatGenerationChunk } from '@langchain/core/outputs'

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
    const toolNames = new Map<string, string>()

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
                          .filter(isMessageContentImageUrl)
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
                string | undefined

            if (thinking != null) {
                msg.thinking = thinking
            }

            if (Array.isArray(toolCalls) && toolCalls.length > 0) {
                msg.tool_calls = toolCalls.map((toolCall, index) => {
                    if (toolCall.id != null) {
                        toolNames.set(toolCall.id, toolCall.name)
                    }

                    return {
                        type: 'function',
                        function: {
                            index,
                            name: toolCall.name,
                            arguments: toolCall.args
                        }
                    }
                })
            }
        }

        if (msg.role === 'tool') {
            const id = (rawMessage as ToolMessage).tool_call_id
            msg.tool_name = rawMessage.name ?? toolNames.get(id)
        }

        result.push(msg)
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

export function ollamaUsageToUsageMetadata(
    chunk: OllamaDeltaResponse
): UsageMetadata | undefined {
    if (chunk.prompt_eval_count == null && chunk.eval_count == null) {
        return undefined
    }

    const inputTokens = chunk.prompt_eval_count ?? 0
    const outputTokens = chunk.eval_count ?? 0

    return {
        input_tokens: inputTokens,
        output_tokens: outputTokens,
        total_tokens: inputTokens + outputTokens
    }
}

export function ollamaChunkToGeneration(chunk: OllamaDeltaResponse) {
    const content = chunk.message?.content ?? ''
    const thinking = chunk.message?.thinking
    const toolCallChunks =
        chunk.message?.tool_calls?.map((call, index) => ({
            name: call.function?.name,
            args:
                call.function?.arguments != null
                    ? JSON.stringify(call.function.arguments)
                    : '{}',
            id: call.id ?? `call_${call.function?.index ?? index}`,
            index: call.function?.index ?? index
        })) ?? []
    const usageMetadata = ollamaUsageToUsageMetadata(chunk)

    if (
        content.length < 1 &&
        thinking == null &&
        toolCallChunks.length < 1 &&
        usageMetadata == null
    ) {
        return undefined
    }

    return new ChatGenerationChunk({
        generationInfo:
            usageMetadata == null
                ? undefined
                : {
                      usage_metadata: usageMetadata
                  },
        message: new AIMessageChunk({
            content,
            tool_call_chunks: toolCallChunks,
            usage_metadata: usageMetadata,
            additional_kwargs:
                thinking == null
                    ? {}
                    : {
                          reasoning_content: thinking
                      }
        }),
        text: content
    })
}
