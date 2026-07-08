import { BaseMessage } from '@langchain/core/messages'
import { Document } from '@langchain/core/documents'
import { HumanMessagePromptTemplate } from '@langchain/core/prompts'
import {
    ChatLunaContextManagerService,
    PromptContextRuntime,
    PromptPipelineMiddleware
} from './context_manager'

// ---------------------------------------------------------------------------
// long_history pipeline middleware
// ---------------------------------------------------------------------------

/**
 * Formats document collections (long memory, knowledge, other documents)
 * into the conversation context using the preset's `longMemoryPrompt`
 * template.  Each document collection is rendered and appended after the
 * history messages.
 *
 * The conversation summary prompt template is expected on
 * `runtime._conversationSummaryPrompt` (set by system_prompts middleware).
 */
export function createLongHistoryMiddleware(): PromptPipelineMiddleware {
    return async (runtime: PromptContextRuntime, next) => {
        const documents = runtime.documents ?? []

        for (const docSet of documents) {
            runtime.usedTokens = await formatLongHistory(
                docSet,
                runtime.chatHistory ?? [],
                runtime.usedTokens,
                runtime.result,
                runtime
            )
        }

        await next()
    }
}

async function formatLongHistory(
    longHistory: Document[],
    chatHistory: BaseMessage[] | string,
    usedTokens: number,
    result: BaseMessage[],
    runtime: PromptContextRuntime
): Promise<number> {
    const formatDocuments: Document[] = []

    for (const document of longHistory) {
        if (document.pageContent.length === 0) continue
        const documentTokens = await runtime.tokenCounter(document.pageContent)

        if (usedTokens + documentTokens > runtime.sendTokenLimit - 80) {
            break
        }

        usedTokens += documentTokens
        formatDocuments.push(document)
    }

    if (formatDocuments.length < 1) {
        return usedTokens
    }

    const summaryPrompt =
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (runtime as any)._conversationSummaryPrompt as
            HumanMessagePromptTemplate | undefined

    if (!summaryPrompt) return usedTokens

    const formatted = await summaryPrompt.format({
        long_history: formatDocuments
            .map(
                (document) =>
                    `<doc metadata="${JSON.stringify(document.metadata)}" id="${document.id}">${document.pageContent}</doc>`
            )
            .join(' '),
        chat_history: chatHistory
    })

    if (formatted) {
        result.push(formatted)
    }

    return usedTokens
}

/**
 * Register the long_history pipeline middleware on the context manager.
 */
export function registerLongHistoryMiddleware(
    contextManager: ChatLunaContextManagerService
): () => void {
    return contextManager.pipeline(
        'long_history',
        createLongHistoryMiddleware(),
        0
    )
}
