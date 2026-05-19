import {
    BaseMessage,
    MessageContentImageUrl,
    MessageType
} from '@langchain/core/messages'
import { OllamaMessage } from './types'
import {
    getMessageContent,
    isMessageContentImageUrl
} from 'koishi-plugin-chatluna/utils/string'
import { ChatLunaPlugin } from 'koishi-plugin-chatluna/services/chat'
import { fetchImageUrl } from '@chatluna/v1-shared-adapter'
import { logger } from '.'

export async function langchainMessageToOllamaMessage(
    messages: BaseMessage[],
    plugin: ChatLunaPlugin,
    supportImage: boolean
): Promise<OllamaMessage[]> {
    const result: OllamaMessage[] = []

    const mappedMessage = await Promise.all(
        messages.map(async (rawMessage) => {
            if (rawMessage.additional_kwargs.images != null) {
                logger.warn(
                    'Deprecated: `additional_kwargs.images` is no longer supported. Use `image_url` content parts instead.'
                )
            }

            const images: string[] | undefined = supportImage
                ? typeof rawMessage.content === 'string'
                    ? undefined
                    : await Promise.all(
                          rawMessage.content
                              .filter((part) => isMessageContentImageUrl(part))
                              .map((part) =>
                                  processOllamaImageContent(plugin, part)
                              )
                      )
                : undefined

            const result = {
                role: messageTypeToOllamaRole(rawMessage.getType()),
                content: getMessageContent(rawMessage.content),
                images: images?.filter(
                    (image): image is string => image != null
                )
            }

            if (result.images == null) {
                delete result.images
            } else if (result.images.length === 0) {
                delete result.images
            } else {
                result.images = result.images.map((image) =>
                    // replace base64 headers
                    image.replace(/^data:image\/\w+;base64,/, '')
                )
            }
            return result
        })
    )

    for (let i = 0; i < mappedMessage.length; i++) {
        const message = {
            ...mappedMessage[i]
        }

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

async function processOllamaImageContent(
    plugin: ChatLunaPlugin,
    part: MessageContentImageUrl
) {
    let url: string
    try {
        url = await fetchImageUrl(plugin, part)
    } catch (e) {
        const rawUrl =
            typeof part.image_url === 'string'
                ? part.image_url
                : part.image_url.url
        logger.warn(`Failed to fetch image url: ${rawUrl}`, e)
        return null
    }

    return url
}

export function messageTypeToOllamaRole(type: MessageType): string {
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
