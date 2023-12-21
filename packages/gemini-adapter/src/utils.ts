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
    // TODO: image vision
    const mappedMessage = messages.map((rawMessage) => {
        const role = messageTypeToGeminiRole(rawMessage._getType())

        const images = rawMessage.additional_kwargs.images as string[] | null

        const result: ChatCompletionResponseMessage = {
            role,
            parts: [
                {
                    text: rawMessage.content as string
                }
            ]
        }

        if (model.includes('vision') && images != null) {
            for (const image of images) {
                result.parts.push({
                    inline_data: {
                        // base64 image match type
                        data: image,
                        mime_type: 'image/jpeg'
                    }
                })
            }
        }

        return result
    })

    const result: ChatCompletionResponseMessage[] = []

    for (let i = 0; i < mappedMessage.length; i++) {
        const message = mappedMessage[i]

        if (message.role !== 'system') {
            result.push(message)
            continue
        }

        /*   if (removeSystemMessage) {
            continue
        } */

        result.push({
            role: 'user',
            parts: message.parts
        })

        if (mappedMessage?.[i + 1]?.role === 'model') {
            continue
        }

        result.push({
            role: 'model',
            parts: [{ text: 'Okay, what do I need to do?' }]
        })
    }

    if (result[result.length - 1].role === 'assistant') {
        result.push({
            role: 'user',
            parts: [
                {
                    text: 'Continue what I said to you last message. Follow these instructions.'
                }
            ]
        })
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
            return 'model'
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
