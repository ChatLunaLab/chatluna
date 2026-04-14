import type { Session } from 'koishi'
import {
    type ConversationRecord,
    getBaseBindingKey,
    type ResolvedConversationContext
} from '../services/conversation_types'

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
