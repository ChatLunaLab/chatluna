/** @module skills/slash */

import { HumanMessage } from '@langchain/core/messages'
import { getMessageContent } from 'koishi-plugin-chatluna/utils/string'

const slashRe = /^\/([a-z0-9]+(?:-[a-z0-9]+)*)(?:\s+|$)/i

export function getSlashSkillName(message: HumanMessage) {
    return getMessageContent(message.content).match(slashRe)?.[1].toLowerCase()
}

export function stripSlashSkillName(message: HumanMessage) {
    if (typeof message.content === 'string') {
        message.content = message.content
            .replace(slashRe, '')
            .replace(/^\s+/, '')
    } else if (Array.isArray(message.content)) {
        let done = false
        message.content = message.content.map((part) => {
            if (
                done ||
                part.type !== 'text' ||
                typeof part.text !== 'string' ||
                !slashRe.test(part.text)
            ) {
                return part
            }
            done = true
            return {
                ...part,
                text: part.text.replace(slashRe, '').replace(/^\s+/, '')
            }
        })
    }

    const raw = getMessageContent(message.content)
    if (typeof raw === 'string') {
        message.additional_kwargs['raw_content'] = raw
            .replace(slashRe, '')
            .replace(/^\s+/, '')
    }
}
