import { AIMessage, BaseMessage } from '@langchain/core/messages'
import {
    ChatLunaContextManagerService,
    PromptContextRuntime,
    PromptPipelineMiddleware
} from './context_manager'
import { countMessagesTokens, countMessageTokens } from './system_prompts'
import { logger } from 'koishi-plugin-chatluna'
import { isChatLunaUserMessage } from 'koishi-plugin-chatluna/utils/langchain'

// ---------------------------------------------------------------------------
// chat_history pipeline middleware
// ---------------------------------------------------------------------------

/**
 * Truncates conversation history to fit within the token budget, keeping
 * the most recent complete turns.  Also accounts for input + scratchpad
 * token consumption so that downstream stages know the remaining budget.
 *
 * Uses usage_metadata from AI messages as a baseline to avoid re-counting
 * tokens for messages that were already counted by the LLM.
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

        // Find baseline: last AI message with usage_metadata in chatHistory
        // Everything up to and including that message has a known token count
        const baseline = findBaseline(chatHistory, runtime.usedTokens)

        if (baseline && hasValidLimit) {
            // We know the total tokens for all messages up to baseline index.
            // Find which rounds are fully before the baseline, which are after.
            let msgIdx = 0
            let baselineRoundIdx = -1
            for (let r = 0; r < rounds.length; r++) {
                msgIdx += rounds[r].length
                if (msgIdx > baseline.idx) {
                    baselineRoundIdx = r
                    break
                }
            }
            if (baselineRoundIdx < 0) baselineRoundIdx = rounds.length - 1

            // Rounds from baselineRoundIdx onward: count individually
            // Rounds before baselineRoundIdx: total is baseline.tokens
            // We iterate from the end, adding rounds until budget is exceeded
            for (let i = rounds.length - 1; i >= 0; i--) {
                const round = rounds[i]

                if (i <= baselineRoundIdx && selectedRounds.length === 0) {
                    // First time hitting baseline region from the end:
                    // all rounds [0..baselineRoundIdx] together = baseline.tokens
                    // Add them all at once
                    const bulkRounds = rounds.slice(0, baselineRoundIdx + 1)
                    const bulkTokens = baseline.tokens
                    const exceedsLimit =
                        usedTokens + bulkTokens > availableLimit

                    if (exceedsLimit && selectedRounds.length > 0) {
                        truncated = true
                        break
                    }

                    usedTokens += bulkTokens
                    for (let j = 0; j <= baselineRoundIdx; j++) {
                        selectedRounds.unshift(bulkRounds[baselineRoundIdx - j])
                    }

                    if (exceedsLimit) {
                        truncated = true
                    }
                    break
                }

                const roundTokens = await countMessagesTokens(
                    round,
                    runtime.tokenCounter
                )
                const exceedsLimit = usedTokens + roundTokens > availableLimit

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
        } else {
            // No baseline, fallback to counting each round
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
 * Find the last AI message with usage_metadata.input_tokens in the history.
 * Returns the index and the estimated history-only tokens up to that point.
 */
function findBaseline(
    messages: BaseMessage[],
    preAccountedTokens: number
): { idx: number; tokens: number } | null {
    for (let i = messages.length - 1; i >= 0; i--) {
        const msg = messages[i]
        if (msg.getType() !== 'ai') continue

        const usage = (msg as AIMessage).usage_metadata
        if (usage?.input_tokens > 0) {
            // input_tokens includes system prompts + history + input.
            // preAccountedTokens already covers system + input + scratchpad.
            // The history portion is roughly: input_tokens - (system + input)
            // But we don't know exact system tokens here. Use a simpler model:
            // The baseline tells us "all messages up to this AI response
            // plus the AI response itself" consumed input_tokens total input.
            // For truncation purposes, we treat it as the token cost of
            // messages[0..i] in the history array.
            return { idx: i, tokens: usage.input_tokens - preAccountedTokens }
        }
    }
    return null
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
