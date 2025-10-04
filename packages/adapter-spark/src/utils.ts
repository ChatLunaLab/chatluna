import {
    AIMessage,
    AIMessageChunk,
    BaseMessage,
    MessageType,
    ToolMessage
} from '@langchain/core/messages'
import { StructuredTool } from '@langchain/core/tools'
import { zodToJsonSchema } from 'zod-to-json-schema'
import { removeAdditionalProperties } from '@chatluna/v1-shared-adapter'
import {
    ChatCompletionDelta,
    ChatCompletionMessage,
    ChatCompletionMessageRoleEnum,
    ChatCompletionTool
} from './types'
import { isZodSchemaV3 } from '@langchain/core/utils/types'

export function langchainMessageToSparkMessage(
    messages: BaseMessage[],
    removeSystemMessage?: boolean
): ChatCompletionMessage[] {
    const mappedMessage = messages.map((it) => {
        const role = messageTypeSparkAIRole(it.getType())

        const msg: ChatCompletionMessage = {
            role,
            tool_call_id: (it as ToolMessage).tool_call_id,
            content: it.content as string,
            name: it.name
        }

        if (it.getType() === 'ai') {
            const toolCalls = (it as AIMessage).tool_calls

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

        return msg
    })

    const result: ChatCompletionMessage[] = []

    for (let i = 0; i < mappedMessage.length; i++) {
        const message = mappedMessage[i]

        if (message.role !== 'system') {
            result.push(message)
            continue
        }

        if (removeSystemMessage) {
            continue
        }

        result.push({
            role: 'user',
            content: message.content
        })

        result.push({
            role: 'assistant',
            content: 'Okay, what do I need to do?'
        })

        if (mappedMessage?.[i + 1]?.role === 'assistant') {
            result.push({
                role: 'user',
                content:
                    'Continue what I said to you last message. Follow these instructions.'
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

    if (result[0].role === 'assistant') {
        result.unshift({
            role: 'user',
            content:
                'Continue what I said to you last time. Follow these instructions.'
        })
    }

    return result
}

export function convertDeltaToMessageChunk(
    delta: ChatCompletionDelta,
    defaultRole: string
): AIMessageChunk {
    const content = delta.content || ''

    const chunk = new AIMessageChunk({
        content,
        additional_kwargs: {}
    })

    if (delta.tool_calls && delta.tool_calls.length > 0) {
        chunk.additional_kwargs.tool_calls = delta.tool_calls.map(
            (toolCall) => ({
                id: toolCall.id,
                type: toolCall.type,
                function: {
                    name: toolCall.function.name,
                    arguments: toolCall.function.arguments
                }
            })
        )
    }

    // Handle reasoning content for thinking models
    if (delta.reasoning_content) {
        chunk.additional_kwargs.reasoning_content = delta.reasoning_content
    }

    return chunk
}

export function messageTypeSparkAIRole(
    type: MessageType
): ChatCompletionMessageRoleEnum {
    switch (type) {
        case 'system':
            return 'system'
        case 'ai':
            return 'assistant'
        case 'human':
            return 'user'
        case 'function':
            return 'user'
        case 'tool':
            return 'user'
        default:
            throw new Error(`Unknown message type: ${type}`)
    }
}

export function formatToolsToSparkTools(
    tools: StructuredTool[]
): ChatCompletionTool[] {
    if (tools.length < 1) {
        return undefined
    }
    return tools.map(formatToolToSparkTool)
}

export function formatToolToSparkTool(
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
            parameters
        }
    }
}

export const modelMapping = {
    'spark-lite': {
        httpModel: 'generalv1',
        wsUrl: 'v1.1/chat',
        model: 'general'
    },
    'spark-pro': {
        httpModel: 'generalv3',
        wsUrl: 'v3.1/chat',
        model: 'generalv3'
    },
    'spark-pro-128k': {
        httpModel: 'pro-128k',
        wsUrl: 'chat/pro-128k',
        model: 'pro-128k'
    },
    'spark-max': {
        httpModel: 'generalv3.5',
        wsUrl: 'v3.5/chat',
        model: 'generalv3.5'
    },
    'spark-max-32k': {
        httpModel: 'max-32k',
        wsUrl: 'chat/max-32k',
        model: 'max-32k'
    },
    'spark-4.0-ultra': {
        httpModel: '4.0Ultra',
        wsUrl: 'v4.0/chat',
        model: '4.0Ultra'
    },
    'spark-x1': {
        httpModel: 'x1',
        wsUrl: '',
        model: 'x1'
    }
}
