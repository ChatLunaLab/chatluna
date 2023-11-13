import {
    AIMessageChunk,
    BaseMessage,
    ChatMessageChunk,
    FunctionMessageChunk,
    HumanMessageChunk,
    MessageType,
    SystemMessageChunk
} from 'langchain/schema'
import {
    ChatCompletionFunctions,
    ChatCompletionResponseMessage,
    ChatCompletionResponseMessageRoleEnum
} from './types'
import { StructuredTool } from 'langchain/tools'
import { zodToJsonSchema } from 'zod-to-json-schema'

export function langchainMessageToOpenAIMessage(
    messages: BaseMessage[]
): ChatCompletionResponseMessage[] {
    return messages.map((message) => {
        const role = messageTypeToOpenAIRole(message._getType())

        const msg = {
            content: (message.content as string) || null,
            name: role === 'assistant' ? message.name : undefined,
            role,
            function_call: message.additional_kwargs.function_call
        }
        if (msg.function_call?.arguments) {
            // Remove spaces, new line characters etc.
            msg.function_call.arguments = JSON.stringify(
                JSON.parse(msg.function_call.arguments)
            )
        }
        return msg
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
    if (tools.length < 1) {
        return undefined
    }
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
    // eslint-disable-next-line @typescript-eslint/naming-convention, @typescript-eslint/no-explicit-any
    let additional_kwargs: { function_call?: any }
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
