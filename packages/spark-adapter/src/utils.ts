import { BaseMessage, MessageType } from '@langchain/core/messages'
import { StructuredTool } from '@langchain/core/tools'
import { zodToJsonSchema } from 'zod-to-json-schema'
import {
    ChatCompletionMessage,
    ChatCompletionMessageRoleEnum,
    ChatCompletionTool
} from './types'

export function langchainMessageToSparkMessage(
    messages: BaseMessage[],
    removeSystemMessage?: boolean
): ChatCompletionMessage[] {
    const mappedMessage = messages.map((it) => {
        const role = messageTypeSparkAIRole(it._getType())

        return {
            role,
            function_call: it.additional_kwargs.tool_calls?.[0]?.function,
            content: it.content as string,
            name: it.name
        } satisfies ChatCompletionMessage
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

    return result
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
    return {
        name: tool.name,
        description: tool.description,
        // any?
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        parameters: zodToJsonSchema(tool.schema as any)
    }
}

export const modelMapping = {
    'v1.5': {
        wsUrl: 'v1.1',
        model: 'general'
    },
    v2: {
        wsUrl: 'v2.1',
        model: 'generalv2'
    },
    v3: {
        wsUrl: 'v3.1',
        model: 'generalv3'
    },
    'v3.5': {
        wsUrl: 'v3.5',
        model: 'generalv3.5'
    },
    v4: {
        wsUrl: 'v4.0',
        model: '4.0Ultra'
    }
}
