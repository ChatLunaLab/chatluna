import { type BaseMessage } from '@langchain/core/messages'

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

    const normalized = head.toLocaleLowerCase()
    const preset = aliases.find(
        (alias) => alias.toLocaleLowerCase() === normalized
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
