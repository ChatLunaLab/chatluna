import { BaseMessage } from '@langchain/core/messages'
import {
    ChatLunaContextManagerService,
    PromptContextMiddleware
} from './context_manager'

// ---------------------------------------------------------------------------
// read_files_context injection middleware
// ---------------------------------------------------------------------------

/**
 * Handles `read_files_context` injections produced by the multimodal
 * file-reading tool.
 *
 * The value is a `HumanMessage` (or array of them) containing multimodal
 * content parts (image_url, audio_url, video_url, inline_data, etc.).
 * We append it directly to the result so it appears as context immediately
 * before the current user input.
 */
export function createReadFilesContextMiddleware(): PromptContextMiddleware {
    return async (context, next) => {
        const value = context.injection.value

        const messages = Array.isArray(value)
            ? (value as BaseMessage[])
            : value instanceof BaseMessage
              ? [value]
              : []

        if (messages.length === 0) {
            return next()
        }

        context.appendMessages(messages)
        context.markHandled()
    }
}

/**
 * Register the read_files_context injection middleware on the context manager.
 */
export function registerReadFilesContextMiddleware(
    contextManager: ChatLunaContextManagerService
): () => void {
    return contextManager.intercept(
        'read_files_context',
        createReadFilesContextMiddleware(),
        0
    )
}
