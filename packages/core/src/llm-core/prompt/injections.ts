import {
    ChatLunaContextManagerService,
    PromptContextRuntime,
    PromptPipelineMiddleware
} from './context_manager'

// ---------------------------------------------------------------------------
// injections pipeline middleware
// ---------------------------------------------------------------------------

/**
 * The `injections` pipeline stage collects all pending injections
 * (persistent + queued + inline from variables) and applies them
 * through the injection middleware chain.
 *
 * This replaces the manual `collectInjections` + `applyInjections`
 * calls that were previously scattered in ChatLunaChatPrompt.
 */
export function createInjectionsMiddleware(
    contextManager: ChatLunaContextManagerService
): PromptPipelineMiddleware {
    return async (runtime: PromptContextRuntime, next) => {
        // Pass runtime.result so collectInjections can stamp ids and prune
        // stale anchor-based persistent injections in place.
        const injections = contextManager.collectInjections({
            variables: runtime.variables,
            configurable: runtime.configurable,
            afterUserMessage: runtime.agentScratchpad
                ? runtime.afterUserMessage
                : undefined,
            currentMessages: runtime.result
        })

        // Apply before-scratchpad injections (lore_books, authors_note, etc.)
        await contextManager.applyInjections(
            injections.beforeScratchpad,
            runtime
        )

        // Push user input
        if (runtime.input) {
            runtime.result.push(runtime.input)
        }

        // Push agent scratchpad
        if (runtime.agentScratchpad) {
            if (Array.isArray(runtime.agentScratchpad)) {
                runtime.result.push(...runtime.agentScratchpad)
            } else {
                runtime.result.push(runtime.agentScratchpad)
            }
        } else if (runtime.input) {
            // No scratchpad – input already pushed above
        }

        // Apply after-scratchpad injections (after_user_message, etc.)
        await contextManager.applyInjections(
            injections.afterScratchpad,
            runtime
        )

        await next()
    }
}

/**
 * Register the injections pipeline middleware on the context manager.
 *
 * This middleware covers the `injections`, `input`, `scratchpad`, and
 * `after_scratchpad` stages in a single pass.
 */
export function registerInjectionsMiddleware(
    contextManager: ChatLunaContextManagerService
): () => void {
    return contextManager.pipeline(
        'injections',
        createInjectionsMiddleware(contextManager),
        0
    )
}
