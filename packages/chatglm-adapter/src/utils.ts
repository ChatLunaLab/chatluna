import {
    AIMessageChunk,
    BaseMessage,
    ChatMessageChunk,
    FunctionMessageChunk,
    HumanMessageChunk,
    MessageType,
    SystemMessageChunk
} from '@langchain/core/messages'
import {
    ChatCompletionFunctions,
    ChatCompletionResponseMessage,
    ChatCompletionResponseMessageRoleEnum
} from './types'
import { StructuredTool } from '@langchain/core/tools'
import { zodToJsonSchema } from 'zod-to-json-schema'

export function langchainMessageToOpenAIMessage(
    messages: BaseMessage[]
): ChatCompletionResponseMessage[] {
    return messages.map((it) => {
        const role = messageTypeToOpenAIRole(it._getType())

        return {
            role,
            content: it.content as string,
            name: role === 'function' ? it.name : undefined
        }
    })
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
        default:
            throw new Error(`Unknown message type: ${type}`)
    }
}

export function formatToolsToOpenAIFunctions(
    tools: StructuredTool[]
): ChatCompletionFunctions[] {
    return tools.map(formatToolToOpenAIFunction)
}

export function formatToolToOpenAIFunction(
    tool: StructuredTool
): ChatCompletionFunctions {
    return {
        name: tool.name,
        description: tool.description,
        // any?
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        parameters: zodToJsonSchema(tool.schema as any)
    }
}

export function convertDeltaToMessageChunk(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    delta: Record<string, any>,
    defaultRole?: ChatCompletionResponseMessageRoleEnum
) {
    const role = delta.role ?? defaultRole
    const content = delta.content ?? ''
    // eslint-disable-next-line @typescript-eslint/naming-convention
    let additional_kwargs
    if (delta.function_call) {
        additional_kwargs = {
            function_call: delta.function_call
        }
    } else {
        additional_kwargs = {}
    }
    if (role === 'user') {
        return new HumanMessageChunk({ content })
    } else if (role === 'assistant') {
        return new AIMessageChunk({ content, additional_kwargs })
    } else if (role === 'system') {
        return new SystemMessageChunk({ content })
    } else if (role === 'function') {
        return new FunctionMessageChunk({
            content,
            additional_kwargs,
            name: delta.name
        })
    } else {
        return new ChatMessageChunk({ content, role })
    }
}
