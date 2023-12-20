import {
    AIMessageChunk,
    BaseMessage,
    ChatMessageChunk,
    HumanMessageChunk,
    MessageType,
    SystemMessageChunk
} from 'langchain/schema'
import {
    ChatCompletionResponseMessage,
    ChatCompletionResponseMessageRoleEnum
} from './types'

export function langchainMessageToGeminiMessage(
    messages: BaseMessage[],
    model?: string
): ChatCompletionResponseMessage[] {
    const result: ChatCompletionResponseMessage[] = []

    for (const rawMessage of messages) {
        const role = messageTypeToGeminiRole(rawMessage._getType())

        const msg = {
            content: (rawMessage.content as string) || null,
            name: role === 'assistant' ? rawMessage.name : undefined,
            role
        } as ChatCompletionResponseMessage

        if (msg.tool_calls) {
            for (const toolCall of msg.tool_calls) {
                const tool = toolCall.function

                if (!tool.arguments) {
                    continue
                }
                // Remove spaces, new line characters etc.
                tool.arguments = JSON.stringify(JSON.parse(tool.arguments))
            }
        }

        const images = rawMessage.additional_kwargs.images as string[] | null

        if (model.includes('vision') && images != null) {
            msg.content = [
                {
                    type: 'text',
                    text: rawMessage.content as string
                }
            ]

            for (const image of images) {
                msg.content.push({
                    type: 'image_url',
                    image_url: {
                        url: image,
                        detail: 'low'
                    }
                })
            }
        }

        result.push(msg)
    }

    return result
}

export function messageTypeToGeminiRole(
    type: MessageType
): ChatCompletionResponseMessageRoleEnum {
    switch (type) {
        case 'system':
            return 'system'
        case 'ai':
            return 'assistant'
        case 'human':
            return 'user'

        default:
            throw new Error(`Unknown message type: ${type}`)
    }
}

export function convertDeltaToMessageChunk(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    delta: Record<string, any>,
    defaultRole?: ChatCompletionResponseMessageRoleEnum
) {
    const role = delta.role ?? defaultRole
    const content = delta.content ?? ''
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/naming-convention
    let additional_kwargs: { function_call?: any; tool_calls?: any }
    if (delta.function_call) {
        additional_kwargs = {
            function_call: delta.function_call
        }
    } else if (delta.tool_calls) {
        additional_kwargs = {
            tool_calls: delta.tool_calls
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
    } else {
        return new ChatMessageChunk({ content, role })
    }
}
