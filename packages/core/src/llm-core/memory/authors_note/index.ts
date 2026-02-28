import { Context } from 'koishi'
import { Config } from 'koishi-plugin-chatluna'

export function apply(ctx: Context, config: Config): void {
    const cache = new Map<string, AuthorsNoteCache>()

    ctx.before(
        'chatluna/chat',
        async (
            conversationId,
            message,
            _promptVariables,
            chatInterface,
            chain
        ) => {
            const preset = chatInterface.preset.value

            const authorsNote = preset.authorsNote

            if (!authorsNote || authorsNote.insertFrequency === 0) {
                return
            }

            const authorsNoteCache = cache.get(conversationId) || {
                chatCount: 1
            }

            if (
                authorsNote.insertFrequency > 0 &&
                authorsNoteCache.chatCount % authorsNote.insertFrequency !== 0
            ) {
                return
            }

            cache.set(conversationId, authorsNoteCache)

            ctx.chatluna.contextManager.inject({
                conversationId,
                name: 'authors_note',
                value: authorsNote,
                once: true
            })
        }
    )

    ctx.on('chatluna/after-chat', async (conversationId, chatInterface) => {
        let authorsNoteCache = cache.get(conversationId)
        if (!authorsNoteCache) {
            authorsNoteCache = {
                chatCount: 0
            }
            cache.set(conversationId, authorsNoteCache)
        }

        authorsNoteCache.chatCount++
    })

    ctx.on(
        'chatluna/clear-chat-history',
        async (conversationId, chatInterface) => {
            cache.delete(conversationId)
            ctx.chatluna.contextManager.clearConversation(conversationId)
        }
    )
}

interface AuthorsNoteCache {
    chatCount: number
}
