import { BaseMessage, MessageType } from '@langchain/core/messages'
import { ClaudeMessage,ChatCompletionResponseMessageRoleEnum } from './types'

export function langchainMessageToClaudeMessage(
    messages: BaseMessage[],
    model?: string
): ClaudeMessage[] {
    const result: ClaudeMessage[] = []

    const mappedMessage = messages.map((rawMessage) => {
        const images = rawMessage.additional_kwargs.images as string[] | null

        const result: ClaudeMessage = {
            role: messageTypeToClaudeRole(rawMessage._getType()),
            content: rawMessage.content as string
        }

        if (model.includes('claude-3') && images != null) {
            result.content = []
            for (const image of images) {
                result.content.push({
                    type: 'image',
                    source: {
                        type: 'base64',
                        media_type: 'image/jpeg',
                        data: image
                    }
                })
            }
            result.content.push({
                type: 'text',
                text: rawMessage.content as string
            })
        }

        return result
    })

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
            content: message.content
        })

        if (mappedMessage?.[i + 1]?.role === 'assistant') {
            continue
        }

        if (mappedMessage?.[i + 1]?.role === 'user') {
            result.push({
                role: 'assistant',
                content: 'Okay, what do I need to do?'
            })
        }
    }

    if (result[result.length - 1].role === 'model') {
        result.push({
            role: 'user',
            content:
                'Continue what I said to you last message. Follow these instructions.'
        })
    }

    return result
}

export function messageTypeToClaudeRole(
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
