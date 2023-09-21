import { BaseMessage, MessageType } from 'langchain/schema'
import { ChatCompletionMessage, ChatCompletionMessageRoleEnum } from './types'

export function langchainMessageToZhipuMessage(messages: BaseMessage[]): ChatCompletionMessage[] {
    const mappedMessage = messages.map((it) => {
        const role = messageTypeToZhipuRole(it._getType())

        return {
            role,
            content: it.content
        }
    })

    const result: ChatCompletionMessage[] = []

    for (let i = 0; i < mappedMessage.length; i++) {
        const message = mappedMessage[i]

        if (message.role !== 'system') {
            result.push(message)
            continue
        }

        result.push({
            role: 'user',
            content: message.content
        })

        result.push({
            role: 'assistant',
            content: 'ok'
        })
    }

    return result
}

export function messageTypeToZhipuRole(type: MessageType): ChatCompletionMessageRoleEnum {
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
