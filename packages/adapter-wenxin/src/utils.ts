import { BaseMessage } from '@langchain/core/messages'
import type { StructuredTool } from '@langchain/core/tools'
import {
    convertDeltaToMessageChunk as convertOpenAIDeltaToMessageChunk,
    formatToolToOpenAITool,
    langchainMessageToOpenAIMessage
} from '@chatluna/v1-shared-adapter'
import { ChatLunaPlugin } from 'koishi-plugin-chatluna/services/chat'
import {
    ChatCompletionFunction,
    WenxinMessage,
    WenxinMessageRole
} from './types'

const CONTINUE_PROMPT =
    'Continue what I said to you last time. Follow these instructions.'

export async function langchainMessageToWenXinMessage(
    messages: BaseMessage[],
    plugin: ChatLunaPlugin,
    model?: string
): Promise<WenxinMessage[]> {
    const mapped = (await langchainMessageToOpenAIMessage(
        messages,
        plugin,
        model
    )) as WenxinMessage[]
    const result: WenxinMessage[] = []

    for (let i = 0; i < mapped.length; i++) {
        const msg = mapped[i]

        if (i === 0 && msg.role === 'assistant') {
            result.push({
                role: 'user',
                content: CONTINUE_PROMPT
            })
        }

        result.push(msg)

        if (
            mapped[i]?.role === 'assistant' &&
            mapped[i + 1]?.role === 'assistant'
        ) {
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

    if (result[0]?.role === 'assistant') {
        result.unshift({
            role: 'user',
            content: CONTINUE_PROMPT
        })
    }

    return result
}

export function formatToolsToWenxinTools(
    tools: StructuredTool[]
): ChatCompletionFunction[] {
    if (tools.length < 1) {
        return undefined
    }

    return tools.map(
        (tool) => formatToolToOpenAITool(tool).function
    ) as ChatCompletionFunction[]
}

export function convertDeltaToMessageChunk(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    delta: Record<string, any>,
    defaultRole?: WenxinMessageRole
) {
    return convertOpenAIDeltaToMessageChunk(delta, defaultRole)
}
