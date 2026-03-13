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
    ChatCompletionTool,
    ZhipuClientConfig
} from './types'

const CONTINUE_PROMPT =
    'Continue what I said to you last time. Follow these instructions.'
const SYSTEM_REPLY = 'Okay, what do I need to do?'

export async function langchainMessageToZhipuMessage(
    messages: BaseMessage[],
    plugin: ChatLunaPlugin,
    model = ''
): Promise<ChatCompletionResponseMessage[]> {
    const mapped = (await langchainMessageToOpenAIMessage(
        messages,
        plugin,
        model
    )) as ChatCompletionResponseMessage[]

    if (model.includes('tools')) {
        for (const msg of mapped) {
            if (Array.isArray(msg.content)) {
                continue
            }

            msg.content = [
                {
                    type: 'text',
                    text: msg.content as string
                }
            ]
        }
    }

    if (model === 'glm-4v-flash') {
        let idx = mapped
            .slice()
            .reverse()
            .findIndex((msg) => Array.isArray(msg.content))

        if (idx !== -1) {
            idx = mapped.length - 1 - idx

            for (let i = idx - 1; i >= 0; i--) {
                const msg = mapped[i]

                if (!Array.isArray(msg.content)) {
                    continue
                }

                msg.content = msg.content.find(
                    (item) => item.type === 'text'
                ).text
            }
        }
    }

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

export function formatToolsToZhipuTools(
    model: string,
    tools: StructuredTool[],
    clientConfig: ZhipuClientConfig
): ChatCompletionTool[] {
    let result: ChatCompletionTool[] = []

    if (clientConfig.retrieval?.length > 0) {
        result.push(
            ...clientConfig.retrieval.map((item) => {
                return {
                    type: 'retrieval',
                    retrieval: {
                        knowledge_id: item,
                        prompt_template:
                            clientConfig.knowledgePromptTemplate?.length > 0
                                ? clientConfig.knowledgePromptTemplate
                                : undefined
                    }
                } satisfies ChatCompletionTool
            })
        )
    }

    if (clientConfig.webSearch && model.includes('tools')) {
        result.push({
            type: 'web_search',
            web_search: {
                enable: true,
                search_engine: 'search_std'
            }
        } satisfies ChatCompletionTool)

        result = result.filter((tool) => tool.type !== 'web_search')
    }

    if (tools?.length > 0) {
        result.push(...tools.map(formatToolToZhipuTool))
    }

    if (result.length < 1) {
        return undefined
    }

    return result
}

export function formatToolToZhipuTool(
    tool: StructuredTool
): ChatCompletionTool {
    return formatToolToOpenAITool(tool) as ChatCompletionTool
}
