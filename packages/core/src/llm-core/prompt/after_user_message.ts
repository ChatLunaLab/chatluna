import { BaseMessage } from '@langchain/core/messages'
import {
    ChatLunaContextManagerService,
    PromptContextMiddleware
} from './context_manager'

// ---------------------------------------------------------------------------
// after_user_message injection middleware
// ---------------------------------------------------------------------------

/**
 * Handles `after_user_message` injections by appending the value (which is
 * typically a BaseMessage or array of BaseMessages) onto the result.
 */
export function createAfterUserMessageMiddleware(): PromptContextMiddleware {
    return async (context, next) => {
        const messages = context.appendMessages(
            context.injection.value as BaseMessage | BaseMessage[]
        )

        if (messages.length > 0) {
            context.markHandled()
            return
        }

        return next()
    }
}

/**
 * Register the after_user_message injection middleware on the context
 * manager.
 */
export function registerAfterUserMessageMiddleware(
    contextManager: ChatLunaContextManagerService
): () => void {
    return contextManager.intercept(
        'after_user_message',
        createAfterUserMessageMiddleware(),
        0
    )
}
