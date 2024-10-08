/* eslint-disable @typescript-eslint/naming-convention */
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
    ChatCompletionFunction,
    ChatCompletionResponse,
    WenxinMessage,
    WenxinMessageRole
} from './types'
import { StructuredTool } from '@langchain/core/tools'
import { zodToJsonSchema } from 'zod-to-json-schema'

export function langchainMessageToWenXinMessage(
    messages: BaseMessage[]
): WenxinMessage[] {
    const mappedMessage = messages.map((it) => {
        const role = messageTypeToWenXinRole(it._getType())

        return {
            role: it.additional_kwargs.function_call ? 'assistant' : role,
            content: it.content.length < 1 ? null : it.content,
            name: role === 'function' ? it.name : undefined,
            function_call:
                role === 'function'
                    ? it.additional_kwargs.function_call
                    : undefined
        }
    })

    const result: WenxinMessage[] = []

    for (let i = 0; i < mappedMessage.length; i++) {
        const message = mappedMessage[i]

        if (i === 0 && message.role === 'assistant') {
            result.push({
                role: 'user',
                content:
                    'Continue what I said to you last time. Follow these instructions.'
            })
        }

        result.push({
            role: message.role,
            content: message.content as string,
            name: message.name,
            function_call: message.function_call
        })

        if (
            mappedMessage?.[i + 1]?.role === 'assistant' &&
            mappedMessage?.[i].role === 'assistant'
        ) {
            result.push({
                role: 'user',
                content:
                    'Continue what I said to you last time. Follow these instructions.'
            })
        }
    }

    if (result[result.length - 1].role === 'assistant') {
        result.push({
            role: 'user',
            content:
                'Continue what I said to you last time. Follow these instructions.'
        })
    }

    return result
}

export function messageTypeToWenXinRole(type: MessageType): WenxinMessageRole {
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

export function convertDeltaToMessageChunk(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    delta: ChatCompletionResponse,
    defaultRole?: WenxinMessageRole
) {
    const role = defaultRole
    const content = delta.result ?? ''
    // eslint-disable-next-line @typescript-eslint/naming-convention

    if (role === 'user') {
        return new HumanMessageChunk({ content })
    } else if (role === 'assistant' && delta.function_call) {
        return new FunctionMessageChunk({
            content,
            name: delta.function_call.name,
            additional_kwargs: {
                function_call: delta.function_call
            }
        })
    } else if (role === 'system') {
        return new SystemMessageChunk({ content })
    } else if (role === 'assistant') {
        return new AIMessageChunk({ content })
    } else {
        return new ChatMessageChunk({ content, role })
    }
}

export function formatToolsToWenxinTools(
    tools: StructuredTool[]
): ChatCompletionFunction[] {
    if (tools.length < 1) {
        return undefined
    }
    return tools.map(formatToolToWenxinTool)
}

export function formatToolToWenxinTool(
    tool: StructuredTool
): ChatCompletionFunction {
    return {
        name: tool.name,
        description: tool.description,
        // any?
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        parameters: zodToJsonSchema(tool.schema as any)
    }
}

export const modelMappedUrl = {
    // eslint-disable-next-line @typescript-eslint/naming-convention
    'ERNIE-4.0': (accessToken: string) => {
        return `https://aip.baidubce.com/rpc/2.0/ai_custom/v1/wenxinworkshop/chat/completions_pro?access_token=${accessToken}`
    },
    // https://aip.baidubce.com/rpc/2.0/ai_custom/v1/wenxinworkshop/chat/ernie-4.0-turbo-8k
    'ERNIE-4.0-turbo': (accessToken: string) => {
        return `https://aip.baidubce.com/rpc/2.0/ai_custom/v1/wenxinworkshop/chat/ernie-4.0-turbo-8k?access_token=${accessToken}`
    },

    // https://aip.baidubce.com/rpc/2.0/ai_custom/v1/wenxinworkshop/chat/completions
    'ERNIE-3.5': (accessToken: string) => {
        return `https://aip.baidubce.com/rpc/2.0/ai_custom/v1/wenxinworkshop/chat/completions?access_token=${accessToken}`
    },

    // https://aip.baidubce.com/rpc/2.0/ai_custom/v1/wenxinworkshop/chat/ernie-3.5-128k
    'ERNIE-3.5-128k': (accessToken: string) => {
        return `https://aip.baidubce.com/rpc/2.0/ai_custom/v1/wenxinworkshop/chat/ernie-3.5-128k?access_token=${accessToken}`
    },

    // https://aip.baidubce.com/rpc/2.0/ai_custom/v1/wenxinworkshop/chat/ernie-speed-pro-128k
    'ERNIE-speed-pro': (accessToken: string) => {
        return `https://aip.baidubce.com/rpc/2.0/ai_custom/v1/wenxinworkshop/chat/ernie-speed-pro-128k?access_token=${accessToken}`
    },
    // https://aip.baidubce.com/rpc/2.0/ai_custom/v1/wenxinworkshop/chat/ernie_speed
    'ERNIE-speed': (accessToken: string) => {
        return `https://aip.baidubce.com/rpc/2.0/ai_custom/v1/wenxinworkshop/chat/ernie_speed?access_token=${accessToken}`
    },
    // https://aip.baidubce.com/rpc/2.0/ai_custom/v1/wenxinworkshop/chat/ernie-speed-128k
    'ERNIE-speed-128k': (accessToken: string) => {
        return `https://aip.baidubce.com/rpc/2.0/ai_custom/v1/wenxinworkshop/chat/ernie-speed-128k?access_token=${accessToken}`
    },
    // https://aip.baidubce.com/rpc/2.0/ai_custom/v1/wenxinworkshop/chat/ernie-lite-8k
    'ERNIE-lite': (accessToken: string) => {
        return `https://aip.baidubce.com/rpc/2.0/ai_custom/v1/wenxinworkshop/chat/ernie-lite-8k?access_token=${accessToken}`
    },
    // https://aip.baidubce.com/rpc/2.0/ai_custom/v1/wenxinworkshop/chat/ernie-lite-pro-128k
    'ERNIE-lite-pro': (accessToken: string) => {
        return `https://aip.baidubce.com/rpc/2.0/ai_custom/v1/wenxinworkshop/chat/ernie-lite-pro-128k?access_token=${accessToken}`
    },
    // https://aip.baidubce.com/rpc/2.0/ai_custom/v1/wenxinworkshop/chat/ernie-tiny-8k
    'ERNIE-tiny': (accessToken: string) => {
        return `https://aip.baidubce.com/rpc/2.0/ai_custom/v1/wenxinworkshop/chat/ernie-tiny-8k?access_token=${accessToken}`
    },
    // https://aip.baidubce.com/rpc/2.0/ai_custom/v1/wenxinworkshop/chat/ernie-novel-8k
    'ERNIE-novel': (accessToken: string) => {
        return `https://aip.baidubce.com/rpc/2.0/ai_custom/v1/wenxinworkshop/chat/ernie-novel-8k?access_token=${accessToken}`
    },
    // https://aip.baidubce.com/rpc/2.0/ai_custom/v1/wenxinworkshop/chat/ernie-char-8k
    'ERNIE-character': (accessToken: string) => {
        return `https://aip.baidubce.com/rpc/2.0/ai_custom/v1/wenxinworkshop/chat/ernie-char-8k?access_token=${accessToken}`
    }
}
