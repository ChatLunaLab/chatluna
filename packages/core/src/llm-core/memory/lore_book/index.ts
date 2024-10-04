import { Context } from 'koishi'
import { Config, logger } from 'koishi-plugin-chatluna'
import { BaseMessage } from '@langchain/core/messages'
import {
    PresetTemplate,
    RoleBook
} from 'koishi-plugin-chatluna/llm-core/prompt'

export function apply(ctx: Context, config: Config): void {
    const cache = new Map<PresetTemplate, LoreBookMatcher>()

    ctx.on(
        'chatluna/before-chat',
        async (
            conversationId,
            message,
            promptVariables,
            chatInterface,
            chain
        ) => {
            const preset = await chatInterface.preset

            if (!preset.loreBooks) {
                return
            }

            let matcher = cache.get(preset)
            if (!matcher) {
                const loreBooks = preset.loreBooks.items
                matcher = new LoreBookMatcher(loreBooks, {
                    scanDepth: preset.loreBooks?.scanDepth,
                    recursiveScan: preset.loreBooks?.recursiveScan,
                    maxRecursionDepth: preset.loreBooks?.maxRecursionDepth
                })
                cache.set(preset, matcher)
            }

            const matchedLores = matcher.matchLoreBooks(
                await chatInterface.chatHistory.getMessages()
            )

            if (matchedLores.length > 0) {
                logger.info(
                    `Found ${matchedLores.length} matched lore books: ${JSON.stringify(
                        matchedLores.map((lore) => lore.keywords)
                    )}`
                )
                promptVariables.loreBooks = matchedLores
            }
        }
    )

    ctx.on(
        'chatluna/clear-chat-history',
        async (conversationId, chatInterface) => {
            cache.clear()
        }
    )
}

export class LoreBookMatcher {
    private loreBooks: RoleBook[]
    config: {
        scanDepth: number
        recursiveScan: boolean
        maxRecursionDepth: number
    }

    private regexCache: Map<string, RegExp>

    constructor(
        loreBooks: RoleBook[],
        config: Partial<LoreBookMatcher['config']> = {}
    ) {
        this.loreBooks = loreBooks
        this.config = {
            scanDepth: config.scanDepth ?? 1,
            recursiveScan: config.recursiveScan ?? true,
            maxRecursionDepth: config.maxRecursionDepth ?? 3
        }
        this.regexCache = new Map()
    }

    matchLoreBooks(messages: BaseMessage[]): RoleBook[] {
        const recentMessages = messages
        const matchedLores = new Set<RoleBook>()
        const processedContent = new Set<string>()

        this.stackMatch(
            recentMessages.map((m) => m.content as string),
            matchedLores,
            processedContent
        )

        return Array.from(matchedLores).sort(
            (a, b) => (a.order ?? 0) - (b.order ?? 0)
        )
    }

    private stackMatch(
        initialContents: string[],
        matchedLores: Set<RoleBook>,
        processedContent: Set<string>
    ): void {
        const stack: [string[], number][] = [[initialContents, 0]]

        while (stack.length > 0) {
            const [contents, depth] = stack.pop()!

            if (depth > this.config.maxRecursionDepth) {
                continue
            }

            const newContents: string[] = []

            for (const content of contents) {
                if (processedContent.has(content)) {
                    continue
                }
                processedContent.add(content)

                for (const loreBook of this.loreBooks) {
                    if (
                        !matchedLores.has(loreBook) &&
                        this.matchKeywords(content, loreBook)
                    ) {
                        matchedLores.add(loreBook)
                        if (this.config.recursiveScan) {
                            newContents.push(loreBook.content)
                        }
                    }
                }
            }

            if (this.config.recursiveScan && newContents.length > 0) {
                stack.push([newContents, depth + 1])
            }
        }
    }

    private matchKeywords(content: string, loreBook: RoleBook): boolean {
        return loreBook.keywords.some((keyword) => {
            const regex = this.getRegexFromKeyword(keyword, loreBook)
            return regex.test(content)
        })
    }

    private getRegexFromKeyword(
        keyword: string | RegExp,
        loreBook: RoleBook
    ): RegExp {
        if (keyword instanceof RegExp) {
            return keyword
        }

        const cacheKey = `${keyword}:${loreBook.caseSensitive}:${loreBook.matchWholeWord}`
        let regex = this.regexCache.get(cacheKey)

        if (!regex) {
            regex = this.createRegexFromKeyword(keyword, loreBook)
            this.regexCache.set(cacheKey, regex)
        }

        return regex
    }

    private createRegexFromKeyword(
        keyword: string,
        loreBook: RoleBook
    ): RegExp {
        let flags = 'g'
        if (!loreBook.caseSensitive) {
            flags += 'i'
        }

        const pattern = loreBook.matchWholeWord ? `\\b${keyword}\\b` : keyword
        return new RegExp(pattern, flags)
    }
}
