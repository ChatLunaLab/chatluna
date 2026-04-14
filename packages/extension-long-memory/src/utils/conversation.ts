import { Context, Session } from 'koishi'

export async function getMemoryScope(
    ctx: Context,
    session: Session,
    options: {
        conversationId?: string
        presetLane?: string
        type?: string
    }
): Promise<{
    conversation: Parameters<Context['chatluna']['clearCache']>[0]
    preset: string
    info: {
        presetId: string
        guildId: string
        userId: string
    }
} | null> {
    const resolved = await ctx.chatluna.conversation.resolveConversation(
        session,
        {
            conversationId: options.conversationId,
            presetLane: options.presetLane,
            mode: 'context'
        }
    )
    const conversation = resolved.conversation

    if (conversation == null) {
        return null
    }

    return {
        conversation,
        preset: options.type ?? resolved.effectivePreset ?? conversation.preset,
        info: {
            presetId:
                options.type ?? resolved.effectivePreset ?? conversation.preset,
            guildId: session.guildId || session.channelId,
            userId: session.userId
        }
    }
}
