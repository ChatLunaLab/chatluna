import type { BaseMessage } from '@langchain/core/messages'
import { h } from 'koishi'
import type { Context, Session } from 'koishi'
import type {} from '@koishijs/censor'
import type { Message } from '../types'
import { isMessageContentText } from './langchain'

export interface PresetLaneParseResult {
    preset?: string
    content?: string
    queryOnly: boolean
}

export function getMessageContent(message: BaseMessage['content']) {
    if (typeof message === 'string') {
        return message
    }

    if (message == null) {
        return ''
    }

    const buffer: string[] = []
    for (const part of message) {
        if (part.type === 'text') {
            buffer.push(part.text as string)
        }
    }
    return buffer.join('')
}

export async function censorMessage(
    ctx: Context,
    message: Message,
    session: Session
): Promise<Message> {
    if (typeof message.content === 'string') {
        return {
            ...message,
            content: h.unescape(
                (
                    await ctx.censor.transform(
                        [h.text(message.content)],
                        session
                    )
                ).join('')
            )
        }
    }

    const parts: Exclude<Message['content'], string> = []
    for (const part of message.content) {
        const prev = parts[parts.length - 1]
        if (
            isMessageContentText(part) &&
            prev != null &&
            isMessageContentText(prev)
        ) {
            prev.text += part.text
            continue
        }
        parts.push(isMessageContentText(part) ? { ...part } : part)
    }

    return {
        ...message,
        content: await Promise.all(
            parts.map(async (part) => {
                if (!isMessageContentText(part)) return part
                return {
                    ...part,
                    text: h.unescape(
                        (
                            await ctx.censor.transform(
                                [h.text(part.text)],
                                session
                            )
                        ).join('')
                    )
                }
            })
        )
    }
}

export function parsePresetLaneInput(
    text: string,
    aliases: string[]
): PresetLaneParseResult | null {
    const source = text.trim()
    if (source.length === 0) {
        return null
    }

    const idx = source.search(/[\s:：,，]/)
    const head = (idx === -1 ? source : source.slice(0, idx)).trim()
    if (head.length === 0) {
        return null
    }

    const lowerHead = head.toLocaleLowerCase()
    const preset = aliases.find(
        (alias) => alias.toLocaleLowerCase() === lowerHead
    )
    if (preset == null) {
        return null
    }

    const rest = (idx === -1 ? '' : source.slice(idx))
        .replace(/^[\s:：,，]+/, '')
        .trim()
    return {
        preset,
        content: rest,
        queryOnly: rest.length === 0
    }
}
