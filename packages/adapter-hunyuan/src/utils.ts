import { BaseMessage } from '@langchain/core/messages'
import type { StructuredTool } from '@langchain/core/tools'
import {
    convertDeltaToMessageChunk as convertOpenAIDeltaToMessageChunk,
    formatToolToOpenAITool,
    langchainMessageToOpenAIMessage
} from '@chatluna/v1-shared-adapter'
import { ChatLunaPlugin } from 'koishi-plugin-chatluna/services/chat'
import {
    ChatCompletionResponseMessage,
    ChatCompletionResponseMessageRoleEnum,
    ChatCompletionTool
} from './types'

const CONTINUE_PROMPT =
    'Continue what I said to you last message. Follow these instructions.'
const SYSTEM_REPLY = 'Okay, what do I need to do?'

export function formatToolsToHunyuanTools(
    tools: StructuredTool[]
): ChatCompletionTool[] {
    if (tools.length < 1) {
        return undefined
    }

    return tools.map(formatToolToHunyuanTool)
}

export function formatToolToHunyuanTool(
    tool: StructuredTool
): ChatCompletionTool {
    return formatToolToOpenAITool(tool) as ChatCompletionTool
}

export async function langchainMessageToHunyuanMessage(
    messages: BaseMessage[],
    plugin: ChatLunaPlugin,
    model: string
): Promise<ChatCompletionResponseMessage[]> {
    const mapped = (await langchainMessageToOpenAIMessage(
        messages,
        plugin,
        model
    )) as ChatCompletionResponseMessage[]
    const result: ChatCompletionResponseMessage[] = []

    for (let i = 0; i < mapped.length; i++) {
        const msg = mapped[i]

        if (msg.role !== 'system') {
            result.push(msg)
            continue
        }

        result.push({
            role: 'user',
            content: msg.content
        })

        result.push({
            role: 'assistant',
            content: SYSTEM_REPLY
        })

        if (mapped[i + 1]?.role === 'assistant') {
            result.push({
                role: 'user',
                content: CONTINUE_PROMPT
            })
        }
    }

    if (result[result.length - 1]?.role === 'assistant') {
        result.push({
            role: 'user',
            content: CONTINUE_PROMPT
        })
    }

    return result
}

export function convertDeltaToMessageChunk(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    delta: Record<string, any>,
    defaultRole?: ChatCompletionResponseMessageRoleEnum
) {
    return convertOpenAIDeltaToMessageChunk(delta, defaultRole)
}
