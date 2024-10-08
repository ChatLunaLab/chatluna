import { Context } from 'koishi'
import { Config } from 'koishi-plugin-chatluna'

export function apply(ctx: Context, config: Config): void {
    const cache = new Map<string, AuthorsNoteCache>()

    ctx.on(
        'chatluna/before-chat',
        async (
            conversationId,
            message,
            promptVariables,
            chatInterface,
            chain
        ) => {
            if (chatInterface.chatMode === 'plugin') {
                return undefined
            }

            const preset = await chatInterface.preset

            const authorsNote = preset.authorsNote
            if (!authorsNote) {
                return
            }

            const authorsNoteCache = cache.get(conversationId)

            if (
                authorsNote.insertFrequency > 0 &&
                authorsNoteCache.chatCount % authorsNote.insertFrequency !== 0
            ) {
                return
            }

            promptVariables['authors_note'] = authorsNote
        }
    )

    ctx.on('chatluna/after-chat', async (conversationId, chatInterface) => {
        const authorsNoteCache = cache.get(conversationId)

        authorsNoteCache.chatCount++
    })

    ctx.on(
        'chatluna/clear-chat-history',
        async (conversationId, chatInterface) => {
            cache.delete(conversationId)
        }
    )
}

interface AuthorsNoteCache {
    chatCount: number
}
