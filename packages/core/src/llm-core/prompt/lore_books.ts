import { AIMessage, BaseMessage } from '@langchain/core/messages'
import { HumanMessagePromptTemplate } from '@langchain/core/prompts'
import { ChainValues } from '@langchain/core/utils/types'
import {
    ChatLunaContextManagerService,
    PromptContextMiddleware,
    PromptContextRuntime
} from './context_manager'
import { PresetTemplate, RoleBook } from './type'
import { logger } from 'koishi-plugin-chatluna'

// ---------------------------------------------------------------------------
// lore_books injection middleware
// ---------------------------------------------------------------------------

/**
 * Handles `lore_books` injections.  Renders each matched lore book using
 * the preset's `loreBooksPrompt` template, then inserts it at the
 * appropriate position in the result message list (respecting
 * `insertPosition`).
 */
export function createLoreBooksMiddleware(): PromptContextMiddleware {
    return async (context, next) => {
        const loreBooks = context.injection.value as RoleBook[]
        const runtime = context.runtime

        if (!Array.isArray(loreBooks) || loreBooks.length < 1) {
            return next()
        }

        const usedTokens = await formatLoreBooks(
            loreBooks,
            runtime.usedTokens,
            runtime.result,
            runtime.variables,
            runtime
        )

        runtime.usedTokens += usedTokens
        context.markHandled()
    }
}

async function formatLoreBooks(
    loreBooks: RoleBook[],
    usedTokens: number,
    result: BaseMessage[],
    variables: ChainValues,
    runtime: PromptContextRuntime
): Promise<number> {
    const preset = runtime.preset
    const tokenCounter = runtime.tokenCounter
    let acceptedLoreTokens = 0

    let usedToken = await tokenCounter(
        preset.config.loreBooksPrompt ?? '{input}'
    )

    const loreBooksPrompt = HumanMessagePromptTemplate.fromTemplate(
        preset.config.loreBooksPrompt ?? '{input}'
    )

    const canUseLoreBooks = {} as Record<
        RoleBook['insertPosition'] | 'default',
        string[]
    >

    const hasLongMemory =
        result.length > 0 &&
        result[result.length - 1].content === 'Ok. I will remember.'

    for (const loreBook of loreBooks) {
        if ((loreBook.content?.length ?? 0) === 0) continue

        const loreBookTokens = await tokenCounter(loreBook.content)

        const tokenLimit =
            runtime.sendTokenLimit -
            (usedTokens + acceptedLoreTokens) -
            (preset.loreBooks?.tokenLimit ?? 300)

        if (loreBookTokens > tokenLimit) {
            logger?.warn(
                `Used tokens: ${usedTokens + acceptedLoreTokens + loreBookTokens} exceed limit: ${tokenLimit}. Is too long lore books. Skipping.`
            )
            break
        }

        const position = loreBook.insertPosition ?? 'default'
        const array = canUseLoreBooks[position] ?? []
        array.push(loreBook.content)
        canUseLoreBooks[position] = array

        acceptedLoreTokens += loreBookTokens
        usedToken += loreBookTokens
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const systemPrompts: BaseMessage[] = (runtime as any)._systemPrompts ?? []

    for (const [position, array] of Object.entries(canUseLoreBooks)) {
        const message = await runtime.promptRenderService
            .renderMessages(
                [await loreBooksPrompt.format({ input: array.join('\n') })],
                variables
            )
            .then((value) => value[0])

        if (position === 'default') {
            if (hasLongMemory) {
                const index = result.findIndex(
                    (msg) =>
                        msg instanceof AIMessage &&
                        msg.content === 'Ok. I will remember.'
                )
                index !== -1
                    ? result.splice(index - 1, 0, message)
                    : result.push(message)
            } else {
                result.push(message)
            }
            continue
        }

        const insertPosition = findMessageIndex(
            result,
            systemPrompts,
            position as RoleBook['insertPosition']
        )
        result.splice(insertPosition, 0, message)
    }

    return usedToken
}

/**
 * Find the index in the result list where a lore book should be inserted
 * based on its `insertPosition` setting.
 */
function findMessageIndex(
    chatHistory: BaseMessage[],
    systemPrompts: BaseMessage[],
    insertPosition:
        | PresetTemplate['loreBooks']['insertPosition']
        | PresetTemplate['authorsNote']['insertPosition']
        | 'before_char'
        | 'after_char'
        | 'in_chat'
): number {
    if (insertPosition === 'in_chat') {
        return chatHistory.length - 1
    }

    const findIndexByType = (type: string) =>
        chatHistory.findIndex(
            (message) => message?.additional_kwargs?.type === type
        )

    const descriptionIndex = findIndexByType('description')
    const personalityIndex = findIndexByType('description')
    const scenarioIndex = findIndexByType('scenario')
    const exampleMessageStartIndex = findIndexByType('example_message_first')
    const exampleMessageEndIndex = findIndexByType('example_message_last')
    const firstMessageIndex = findIndexByType('first_message')

    const charDefIndex = Math.max(descriptionIndex, personalityIndex)

    switch (insertPosition) {
        case 'before_char_defs':
        case 'before_char':
            return charDefIndex !== -1 ? charDefIndex : 1

        case 'after_char_defs':
        case 'after_char':
            if (scenarioIndex !== -1) return scenarioIndex + 1
            return charDefIndex !== -1
                ? charDefIndex + 1
                : systemPrompts.length + 1

        case 'before_example_messages':
            if (exampleMessageStartIndex !== -1) return exampleMessageStartIndex
            if (firstMessageIndex !== -1) return firstMessageIndex
            return charDefIndex !== -1 ? charDefIndex + 1 : 1

        case 'after_example_messages':
            if (exampleMessageEndIndex !== -1) return exampleMessageEndIndex + 1
            return charDefIndex !== -1
                ? charDefIndex + 1
                : systemPrompts.length - 1

        default:
            return 1
    }
}

/**
 * Register the lore_books injection middleware on the context manager.
 */
export function registerLoreBooksMiddleware(
    contextManager: ChatLunaContextManagerService
): () => void {
    return contextManager.intercept(
        'lore_books',
        createLoreBooksMiddleware(),
        0
    )
}

// Re-export findMessageIndex for use by other middlewares (e.g. authors_note)
export { findMessageIndex }
