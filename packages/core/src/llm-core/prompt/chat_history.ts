import { BaseMessage } from '@langchain/core/messages'
import {
    ChatLunaContextManagerService,
    PromptContextRuntime,
    PromptPipelineMiddleware
} from './context_manager'
import { countMessagesTokens, countMessageTokens } from './system_prompts'
import { logger } from 'koishi-plugin-chatluna'

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
            const input = runtime.input
            const inputMessageForCount = {
                ...input,
                content:
                    typeof input.content === 'string'
                        ? input.content
                        : JSON.stringify(input.content),
                getType: () => input.getType()
            } as BaseMessage
            const inputTokens = await countMessageTokens(
                inputMessageForCount,
                runtime.tokenCounter
            )
            runtime.usedTokens += inputTokens
        }

        // Pre-account scratchpad tokens
        if (runtime.agentScratchpad) {
            if (Array.isArray(runtime.agentScratchpad)) {
                runtime.usedTokens += await countMessagesTokens(
                    runtime.agentScratchpad,
                    runtime.tokenCounter
                )
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
            const roundTokens = await countMessagesTokens(
                round,
                runtime.tokenCounter
            )
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
            usedTokens += await countMessagesTokens(
                lastRound,
                runtime.tokenCounter
            )
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
 * Split a flat message list into conversation rounds.
 * A round starts with a human message and includes all following non-human
 * messages until the next human message.
 */
function buildConversationRounds(messages: BaseMessage[]): BaseMessage[][] {
    const rounds: BaseMessage[][] = []
    let current: BaseMessage[] = []

    for (const message of messages) {
        if (message.getType() === 'human') {
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
