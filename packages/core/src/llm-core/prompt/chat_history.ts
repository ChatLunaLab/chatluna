import { BaseMessage } from '@langchain/core/messages'
import {
    ChatLunaContextManagerService,
    PromptContextRuntime,
    PromptPipelineMiddleware
} from './context_manager'
import { countMessageTokens } from './system_prompts'

// ---------------------------------------------------------------------------
// chat_history pipeline middleware
// ---------------------------------------------------------------------------

/** Account for the complete history; compaction runs after prompt assembly. */
export function createChatHistoryMiddleware(): PromptPipelineMiddleware {
    return async (runtime: PromptContextRuntime, next) => {
        const chatHistory = runtime.chatHistory ?? []

        // Pre-account input tokens
        if (runtime.input) {
            const inputTokens = await countMessageTokens(
                runtime.input,
                runtime.tokenCounter
            )
            runtime.usedTokens += inputTokens
        }

        // Pre-account scratchpad tokens
        if (runtime.agentScratchpad) {
            if (Array.isArray(runtime.agentScratchpad)) {
                for (const msg of runtime.agentScratchpad) {
                    runtime.usedTokens += await countMessageTokens(
                        msg,
                        runtime.tokenCounter
                    )
                }
            } else {
                runtime.usedTokens += await countMessageTokens(
                    runtime.agentScratchpad as BaseMessage,
                    runtime.tokenCounter
                )
            }
        }

        for (const msg of chatHistory) {
            runtime.usedTokens += await countMessageTokens(
                msg,
                runtime.tokenCounter
            )
        }
        runtime.result.push(...chatHistory)

        await next()
    }
}

/**
 * Register the chat_history pipeline middleware on the context manager.
 */
export function registerChatHistoryMiddleware(
    contextManager: ChatLunaContextManagerService
): () => void {
    return contextManager.pipeline(
        'chat_history',
        createChatHistoryMiddleware(),
        0
    )
}
