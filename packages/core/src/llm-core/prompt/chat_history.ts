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

/** Keep managed history intact; trim complete turns without compaction state. */
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

        if (runtime.configurable?.context) {
            for (const msg of chatHistory) {
                runtime.usedTokens += await countMessageTokens(
                    msg,
                    runtime.tokenCounter
                )
            }
            runtime.result.push(...chatHistory)
        } else {
            let start = chatHistory.length
            let tokens = 0
            for (let idx = chatHistory.length - 1; idx >= 0; idx--) {
                const msg = chatHistory[idx]
                tokens += await countMessageTokens(msg, runtime.tokenCounter)
                if (idx > 0 && msg.getType() !== 'human') continue

                const exceeds =
                    runtime.usedTokens + tokens > runtime.sendTokenLimit
                if (exceeds && start < chatHistory.length) break

                // Keep the latest turn even if it cannot fit; the model layer
                // reports that overflow instead of silently losing the turn.
                start = idx
                runtime.usedTokens += tokens
                tokens = 0
                if (exceeds) break
            }
            runtime.result.push(...chatHistory.slice(start))
        }

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
