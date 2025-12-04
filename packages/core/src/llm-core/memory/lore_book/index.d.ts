import { Context } from 'koishi'
import { Config } from 'koishi-plugin-chatluna'
import { BaseMessage } from '@langchain/core/messages'
import { RoleBook } from 'koishi-plugin-chatluna/llm-core/prompt'
export declare function apply(ctx: Context, config: Config): void
export declare class LoreBookMatcher {
    private loreBooks
    private defaultConfig
    private regexCache
    constructor(loreBooks: RoleBook[], defaultConfig?: Partial<LoreBookConfig>)
    matchLoreBooks(messages: BaseMessage[]): RoleBook[]
    private stackMatch
    private matchKeywords
    private getRegexFromKeyword
    private splitContent
    private createRegexFromKeyword
    private getConfig
}
interface LoreBookConfig {
    scanDepth: number
    recursiveScan: boolean
    maxRecursionDepth: number
    matchWholeWord: boolean
    caseSensitive: boolean
}
export {}
