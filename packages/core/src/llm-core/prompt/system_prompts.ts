import { SystemMessage } from '@langchain/core/messages'
import { HumanMessagePromptTemplate } from '@langchain/core/prompts'
import {
    ChatLunaContextManagerService,
    PromptContextRuntime,
    PromptPipelineMiddleware
} from './context_manager'
import { logger } from 'koishi-plugin-chatluna'
import {
    countMessagesTokens,
    countMessageTokens
} from 'koishi-plugin-chatluna/llm-core/utils/count_tokens'

export { countMessageTokens, countMessagesTokens }

// ---------------------------------------------------------------------------
// system_prompts pipeline middleware
// ---------------------------------------------------------------------------

/**
 * Renders the preset template into system messages and pushes them onto
 * the result list.  Also handles the optional `instructions` partial.
 *
 * Populates `runtime._conversationSummaryPrompt` for later use by the
 * long_history middleware.
 */
export function createSystemPromptsMiddleware(): PromptPipelineMiddleware {
    // Cache to avoid re-computing when preset hasn't changed
    let _cachedPreset: unknown = null
    let _cachedSummaryPrompt: HumanMessagePromptTemplate | null = null

    return async (runtime: PromptContextRuntime, next) => {
        const preset = runtime.preset
        const variables = runtime.variables
        const configurable = runtime.configurable

        // -- instructions (e.g. agent instructions) --
        if (runtime.instructions) {
            const msg = new SystemMessage(runtime.instructions)
            const tokens = await countMessageTokens(msg, runtime.tokenCounter)
            runtime.result.push(msg)
            runtime.usedTokens += tokens
        }

        // -- render preset system prompts --
        const rendered = await runtime.promptRenderService.renderPresetTemplate(
            preset,
            variables,
            { configurable: configurable ?? {} }
        )

        for (const message of rendered.messages ?? []) {
            const tokens = await countMessageTokens(
                message,
                runtime.tokenCounter
            )
            runtime.result.push(message)
            runtime.usedTokens += tokens
        }

        // -- prepare conversation summary prompt for long_history middleware --
        if (_cachedPreset !== preset) {
            _cachedSummaryPrompt = HumanMessagePromptTemplate.fromTemplate(
                preset.config.longMemoryPrompt ??
                    // eslint-disable-next-line max-len
                    `<system>As you answer the user's questions, you can use the following context: <context>{long_history}</context>

Guidelines for response:
1. The context above may contain documents, memories, or knowledge to help you better assist the user.
2. Determine whether the content is documents, memories, or knowledge, and respond accordingly.
3. If the user's question or chat is unrelated to the provided context, ignore the documents, memories, and knowledge.
4. Use the system prompt as your primary guide and incorporate the context only when relevant.

Your goal is to provide better assistance based on these materials while maintaining natural and coherent responses.
</system>`
            )
            _cachedPreset = preset
        }

        // Stash summary prompt on runtime for long_history middleware
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        ;(runtime as any)._conversationSummaryPrompt = _cachedSummaryPrompt
        // Stash rendered system prompts for position lookup
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        ;(runtime as any)._systemPrompts = rendered.messages ?? []

        if (runtime.usedTokens > runtime.sendTokenLimit) {
            logger?.warn(
                // eslint-disable-next-line max-len
                `After system prompts, the max tokens exceeded: ${runtime.usedTokens} > ${runtime.sendTokenLimit}. Try increasing the adapter token limit or optimizing the system prompts.`
            )
        }

        await next()
    }
}

/**
 * Register the system_prompts pipeline middleware on the context manager.
 */
export function registerSystemPromptsMiddleware(
    contextManager: ChatLunaContextManagerService
): () => void {
    return contextManager.pipeline(
        'system_prompts',
        createSystemPromptsMiddleware(),
        0
    )
}
