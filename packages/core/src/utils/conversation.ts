import type { Session } from 'koishi'
import {
    type ConversationRecord,
    getBaseBindingKey,
    type ResolvedConversationContext
} from '../types'

export function getFallbackBindingKeys(session: Session, bindingKey: string) {
    const idx = bindingKey.indexOf(':preset:')
    const suffix = idx >= 0 ? bindingKey.slice(idx) : ''

    if (bindingKey.startsWith('custom:')) {
        return []
    }

    const guildOrChannel = session.guildId ?? session.channelId ?? 'unknown'
    return session.isDirect
        ? [`personal:legacy:legacy:direct:${session.userId}${suffix}`]
        : bindingKey.startsWith('shared:')
          ? [
                `shared:legacy:legacy:${guildOrChannel}${suffix}`,
                `personal:legacy:legacy:${guildOrChannel}:${session.userId}${suffix}`
            ]
          : [
                `personal:legacy:legacy:${guildOrChannel}:${session.userId}${suffix}`,
                `shared:legacy:legacy:${guildOrChannel}${suffix}`
            ]
}

export function getLookupKeys(
    session: Session,
    bindingKey: string,
    allPresetLanes = false
) {
    const keys = new Set<string>()

    keys.add(allPresetLanes ? getBaseBindingKey(bindingKey) : bindingKey)

    for (const key of getFallbackBindingKeys(session, bindingKey)) {
        keys.add(allPresetLanes ? getBaseBindingKey(key) : key)
    }

    return Array.from(keys)
}

export function pickBindingKey(
    resolved: ResolvedConversationContext,
    conversation: ConversationRecord
) {
    return conversation.bindingKey === resolved.bindingKey
        ? resolved.bindingKey
        : conversation.bindingKey
}

export function parseDeleteSeqs(input?: string): number[] | null | undefined {
    if (input == null || input.length === 0) {
        return
    }

    // Only pure number/range selectors are batch targets. Titles such as
    // "Claude Code 黑子" must stay intact and return undefined.
    if (
        !/^\d+(?:\.\.\d+)?(?:(?:\s*[,，;；]\s*|\s+)\d+(?:\.\.\d+)?)*$/.test(
            input
        )
    ) {
        return
    }

    if (input.length > 512) return null

    const parts = input.split(/[,，;；\s]+/).filter((part) => part.length > 0)
    if (parts.length > 100) return null

    const seqs = new Set<number>()
    for (const part of parts) {
        const match = /^(\d+)(?:\.\.(\d+))?$/.exec(part)
        if (match == null) return null

        const start = Number(match[1])
        const end = Number(match[2] ?? match[1])
        if (
            !Number.isSafeInteger(start) ||
            !Number.isSafeInteger(end) ||
            start < 1 ||
            end < 1
        ) {
            return null
        }

        const min = Math.min(start, end)
        const max = Math.max(start, end)

        for (let seq = min; seq <= max; seq += 1) {
            seqs.add(seq)
            if (seqs.size > 100) return null
        }
    }

    return Array.from(seqs)
}
