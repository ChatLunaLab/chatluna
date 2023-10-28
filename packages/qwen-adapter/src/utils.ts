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
    ChatCompletionResponseMessageRoleEnum,
    ChatCompletionStreamResponse
} from './types'

export function langchainMessageToQWenMessage(
    messages: BaseMessage[]
): ChatCompletionResponseMessage[] {
    return messages.map((it) => {
        const role = messageTypeToQWenRole(it._getType())

        return {
            role,
            content: it.content
        }
    })
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
