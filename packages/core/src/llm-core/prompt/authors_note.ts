import { BaseMessage, HumanMessage } from '@langchain/core/messages'
import {
    ChatLunaContextManagerService,
    PromptContextMiddleware
} from './context_manager'
import { AuthorsNote } from './type'
import { findMessageIndex } from './lore_books'

// ---------------------------------------------------------------------------
// authors_note injection middleware
// ---------------------------------------------------------------------------

/**
 * Handles `authors_note` injections.  Renders the note content using the
 * prompt render service, counts its tokens, then inserts it at the
 * configured position in the result list.
 */
export function createAuthorsNoteMiddleware(): PromptContextMiddleware {
    return async (context, next) => {
        const authorsNote = context.injection.value as AuthorsNote
        const runtime = context.runtime

        if (!authorsNote || (authorsNote.content?.length ?? 0) < 1) {
            return next()
        }

        // Render template variables in the note content
        const formatAuthorsNote = await runtime.promptRenderService
            .renderTemplate(authorsNote.content, runtime.variables, {
                configurable: runtime.configurable ?? {}
            })
            .then((value) => value.text)

        const tokenCount = await runtime.tokenCounter(formatAuthorsNote)

        if (tokenCount <= 0) {
            return next()
        }

        runtime.usedTokens += tokenCount

        // Determine insertion position
        const rawPosition = authorsNote.insertPosition ?? 'in_chat'

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const systemPrompts: BaseMessage[] =
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            (runtime as any)._systemPrompts ?? []

        const insertPosition = findMessageIndex(
            runtime.result,
            systemPrompts,
            rawPosition
        )

        if (rawPosition === 'in_chat') {
            const safeInsertPosition = Math.max(
                0,
                insertPosition - (authorsNote.insertDepth ?? 0)
            )

            runtime.result.splice(
                safeInsertPosition,
                0,
                new HumanMessage(formatAuthorsNote)
            )
        } else {
            runtime.result.splice(
                insertPosition,
                0,
                new HumanMessage(formatAuthorsNote)
            )
        }

        context.markHandled()
    }
}

/**
 * Register the authors_note injection middleware on the context manager.
 */
export function registerAuthorsNoteMiddleware(
    contextManager: ChatLunaContextManagerService
): () => void {
    return contextManager.intercept(
        'authors_note',
        createAuthorsNoteMiddleware(),
        0
    )
}
