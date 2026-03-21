import fs from 'fs/promises'
import type { Context } from 'koishi'

export async function purgeArchivedConversation(
    ctx: Context,
    conversation: {
        id: string
        archiveId?: string | null
    }
) {
    if (conversation.archiveId != null) {
        const archive = await ctx.chatluna.conversation.getArchive(
            conversation.archiveId
        )

        if (archive?.path) {
            await fs.rm(archive.path, {
                recursive: true,
                force: true
            })
        }

        await ctx.database.remove('chatluna_archive', {
            id: conversation.archiveId
        })
    }

    const bindings = await ctx.database.get('chatluna_binding', {})
    for (const binding of bindings) {
        if (
            binding.activeConversationId !== conversation.id &&
            binding.lastConversationId !== conversation.id
        ) {
            continue
        }

        await ctx.database.upsert('chatluna_binding', [
            {
                ...binding,
                activeConversationId:
                    binding.activeConversationId === conversation.id
                        ? null
                        : binding.activeConversationId,
                lastConversationId:
                    binding.lastConversationId === conversation.id
                        ? null
                        : binding.lastConversationId,
                updatedAt: new Date()
            }
        ])
    }

    await ctx.database.remove('chatluna_message', {
        conversationId: conversation.id
    })
    await ctx.database.remove('chatluna_acl', {
        conversationId: conversation.id
    })
    await ctx.database.remove('chatluna_conversation', {
        id: conversation.id
    })
}
