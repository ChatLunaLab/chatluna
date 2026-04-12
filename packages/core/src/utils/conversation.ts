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
    allPresetLanes = false,
    resolveIncludeArchived = includeArchived
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
                String(item.displaySeq),
                item.conversation.title
            ])
        )
    ).filter((item) => item.length > 0)

    if (/^\d+$/.test(value)) {
        const seq = Number(value)
        const bySeq = entries.filter((item) => item.displaySeq === seq)

        if (bySeq.length === 1) {
            return bySeq[0].conversation.id
        }
    }

    try {
        const conversation =
            await ctx.chatluna.conversation.resolveCommandConversation(
                session,
                {
                    targetConversation: value,
                    presetLane,
                    includeArchived: resolveIncludeArchived,
                    allPresetLanes
                }
            )

        if (conversation != null) {
            return conversation.id
        }
    } catch {}

    if (expect.length === 0) {
        return value
    }

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
