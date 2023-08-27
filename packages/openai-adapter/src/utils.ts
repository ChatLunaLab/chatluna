import { BaseMessage, MessageType } from 'langchain/schema';
import { ChatCompletionFunctions, ChatCompletionResponseMessage } from './types';
import { StructuredTool } from 'langchain/tools';
import { zodToJsonSchema } from "zod-to-json-schema";


export function langchainMessageToOpenAIMessage(messages: BaseMessage[]): ChatCompletionResponseMessage[] {
    return messages.map(it => {
        const role = messageTypeToOpenAIRole(it._getType())

        return {
            role,
            content: it.content,
            name: role === "function" ? it.name : undefined,
        }
    })
}

export function messageTypeToOpenAIRole(
    type: MessageType
): "system" | 'assistant' | 'user' | 'function' {
    switch (type) {
        case "system":
            return "system";
        case "ai":
            return "assistant";
        case "human":
            return "user";
        case "function":
            return "function";
        default:
            throw new Error(`Unknown message type: ${type}`);
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
        parameters: zodToJsonSchema(tool.schema as any),
    }
}
