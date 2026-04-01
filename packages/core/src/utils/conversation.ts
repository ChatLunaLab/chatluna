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

    const conversations = await ctx.chatluna.conversation.listConversations(
        session,
        {
            presetLane,
            allPresetLanes,
            includeArchived
        }
    )
    const expect = Array.from(
        new Set(
            conversations.flatMap((conversation) => [
                conversation.id,
                String(conversation.seq ?? ''),
                conversation.title
            ])
        )
    ).filter((item) => item.length > 0)

    if (expect.length === 0) {
        return value
    }

    return session.suggest({
        actual: value,
        expect,
        suffix: session.text(suffix)
    })
}
