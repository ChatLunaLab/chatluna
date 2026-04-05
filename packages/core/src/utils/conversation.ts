import type { Context, Session } from 'koishi'
import {
    type ConversationRecord,
    getBaseBindingKey,
    type ResolvedConversationContext
} from '../services/conversation_types'

export async function completeConversationTarget(
    ctx: Context,
    session: Session,
    target: string | undefined,
    presetLane?: string,
    includeArchived = true,
    suffix = 'commands.chatluna.chat.text.options.conversation',
    allPresetLanes = false
) {
    const value =
        target == null || target.trim().length < 1 ? undefined : target.trim()
    if (value == null) {
        return undefined
    }

    const entries = await ctx.chatluna.conversation.listConversationEntries(
        session,
        {
            presetLane,
            allPresetLanes,
            includeArchived
        }
    )
    const expect = Array.from(
        new Set(
            entries.flatMap((item) => [
                item.conversation.id,
                String(
                    allPresetLanes && presetLane == null
                        ? item.displaySeq
                        : (item.conversation.seq ?? '')
                ),
                item.conversation.title
            ])
        )
    ).filter((item) => item.length > 0)

    if (expect.length === 0) {
        return value
    }

    if (expect.includes(value)) {
        return value
    }

    try {
        if (
            (await ctx.chatluna.conversation.resolveCommandConversation(
                session,
                {
                    targetConversation: value,
                    presetLane,
                    includeArchived,
                    allPresetLanes
                }
            )) != null
        ) {
            return value
        }
    } catch {}

    return session.suggest({
        actual: value,
        expect,
        suffix: session.text(suffix)
    })
}

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
