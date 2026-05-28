import { BaseMessage } from '@langchain/core/messages'
import {
    ChatLunaContextManagerService,
    PromptContextRuntime,
    PromptPipelineMiddleware
} from './context_manager'
import { countMessageTokens } from './system_prompts'
import { logger } from 'koishi-plugin-chatluna'
import { isChatLunaUserMessage } from 'koishi-plugin-chatluna/utils/langchain'

// ---------------------------------------------------------------------------
// chat_history pipeline middleware
// ---------------------------------------------------------------------------

/**
 * Truncates conversation history to fit within the token budget, keeping
 * the most recent complete turns.  Also accounts for input + scratchpad
 * token consumption so that downstream stages know the remaining budget.
 */
export function createChatHistoryMiddleware(): PromptPipelineMiddleware {
    return async (runtime: PromptContextRuntime, next) => {
        const chatHistory = runtime.chatHistory ?? []
        const documents = runtime.documents ?? []

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

        // Build conversation rounds and truncate
        const rounds = buildConversationRounds([...chatHistory])
        const selectedRounds: BaseMessage[][] = []
        const availableLimit =
            runtime.sendTokenLimit - (documents.length > 0 ? 480 : 80)
        const hasValidLimit = availableLimit > 0
        let truncated = false
        let usedTokens = runtime.usedTokens

        for (let i = rounds.length - 1; i >= 0; i--) {
            const round = rounds[i]
            let roundTokens = 0
            for (const msg of round) {
                roundTokens += await countMessageTokens(
                    msg,
                    runtime.tokenCounter
                )
            }
            const exceedsLimit = hasValidLimit
                ? usedTokens + roundTokens > availableLimit
                : false

            if (exceedsLimit && selectedRounds.length > 0) {
                truncated = true
                break
            }

            usedTokens += roundTokens
            selectedRounds.unshift(round)

            if (exceedsLimit) {
                truncated = true
                break
            }
        }

        // Ensure at least one round
        if (rounds.length > 0 && selectedRounds.length === 0) {
            const lastRound = rounds[rounds.length - 1]
            for (const msg of lastRound) {
                usedTokens += await countMessageTokens(
                    msg,
                    runtime.tokenCounter
                )
            }
            selectedRounds.unshift(lastRound)
            truncated = hasValidLimit
        }

        // Flatten selected rounds and push
        const historyMessages = selectedRounds.reduce<BaseMessage[]>(
            (acc, round) => acc.concat(round),
            []
        )
        runtime.result.push(...historyMessages)
        runtime.usedTokens = usedTokens

        if (truncated && hasValidLimit) {
            logger?.warn(
                `Exceeded token limit (${usedTokens} > ${availableLimit}) of the message placeholder; kept the most recent complete turns.`
            )
        }

        await next()
    }
}

/**
 * Split a flat message list into conversation rounds. Marked ChatLuna user
 * messages start rounds; old unmarked human messages still start rounds.
 */
function buildConversationRounds(messages: BaseMessage[]): BaseMessage[][] {
    const rounds: BaseMessage[][] = []
    let current: BaseMessage[] = []

    for (const message of messages) {
        const isStart =
            isChatLunaUserMessage(message) || message.getType() === 'human'

        if (isStart) {
            if (current.length > 0) {
                rounds.push(current)
            }
            current = [message]
        } else {
            if (current.length === 0) {
                current = [message]
            } else {
                current.push(message)
            }
        }
    }

    if (current.length > 0) {
        rounds.push(current)
    }

    return rounds
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
