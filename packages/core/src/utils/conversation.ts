import { Context, Session } from 'koishi'

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

    return session.suggest({
        actual: value,
        expect,
        suffix: session.text(suffix)
    })
}
