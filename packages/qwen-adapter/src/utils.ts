import {
    AIMessageChunk,
    BaseMessage,
    ChatMessageChunk,
    HumanMessageChunk,
    MessageType,
    SystemMessageChunk
} from 'langchain/schema'
import {
    ChatCompletionMessage,
    ChatCompletionResponseMessageRoleEnum,
    ChatCompletionStreamResponse
} from './types'

export function langchainMessageToQWenMessage(
    messages: BaseMessage[]
): ChatCompletionMessage[] {
    const mappedMessage = messages.map((it) => {
        const role = messageTypeToQWenRole(it._getType())

        return {
            role,
            content: it.content as string
        }
    })

    const result: ChatCompletionMessage[] = []

    for (let i = 0; i < mappedMessage.length; i++) {
        const message = mappedMessage[i]

        result.push({
            role: message.role,
            content: message.content
        })

        if (
            mappedMessage?.[i + 1]?.role === 'assistant' &&
            (mappedMessage?.[i].role === 'assistant' ||
                mappedMessage?.[i]?.role === 'system')
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

export function messageTypeToQWenRole(
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
    delta: ChatCompletionStreamResponse['output'],
    defaultRole?: ChatCompletionResponseMessageRoleEnum
) {
    const role = defaultRole
    const content = delta.text

    // TODO: function calling for qwen??

    if (role === 'user') {
        return new HumanMessageChunk({ content })
    } else if (role === 'assistant') {
        return new AIMessageChunk({ content /* , additional_kwargs  */ })
    } else if (role === 'system') {
        return new SystemMessageChunk({ content })
    } else {
        return new ChatMessageChunk({ content, role })
    }
}
