import { BaseMessage } from '@langchain/core/messages'

export interface RawPreset {
    keywords: string[]
    prompts: {
        role: 'user' | 'system' | 'assistant'
        type?: 'personality' | 'description' | 'first_message' | 'scenario'
        content: string
    }[]
    format_user_prompt?: string
    world_lores?: (
        | {
              scanDepth?: number
              tokenLimit?: number
              recursiveScan?: boolean
              maxRecursionDepth?: number
              insertPosition?:
                  | 'before_char_defs'
                  | 'after_char_defs'
                  | 'before_scenario'
                  | 'after_scenario'
                  | 'before_example_messages'
                  | 'after_example_messages'
          }
        | {
              keywords: string | (string | RegExp)[]
              content: string
              order?: number
              insertPosition?:
                  | 'before_char_defs'
                  | 'after_char_defs'
                  | 'before_scenario'
                  | 'after_scenario'
                  | 'before_example_messages'
                  | 'after_example_messages'
              recursiveScan?: boolean
              matchWholeWord?: boolean
              caseSensitive?: boolean
          }
    )[]
    version?: string
    authors_note?: AuthorsNote
    config?: {
        longMemoryPrompt?: string
        loreBooksPrompt?: string
        longMemoryExtractPrompt?: string
    }
}

export interface RoleBook {
    keywords: (string | RegExp)[]
    content: string
    recursiveScan?: boolean
    matchWholeWord?: boolean
    caseSensitive?: boolean
    order?: number
    insertPosition?:
        | 'before_char_defs'
        | 'after_char_defs'
        | 'before_example_messages'
        | 'after_example_messages'
}

export type RoleBookConfig = Omit<PresetTemplate['loreBooks'], 'items'>

export interface PresetTemplate {
    version?: string
    triggerKeyword: string[]
    rawText: string
    messages: BaseMessage[]
    formatUserPromptString?: string
    path?: string
    loreBooks?: {
        scanDepth?: number
        items: RoleBook[]
        tokenLimit?: number
        recursiveScan?: boolean
        maxRecursionDepth?: number
        insert_position?:
            | 'before_char_defs'
            | 'after_char_defs'
            | 'before_example_messages'
            | 'after_example_messages'
    }
    authorsNote?: AuthorsNote
    config: {
        longMemoryPrompt?: string
        loreBooksPrompt?: string
        longMemoryExtractPrompt?: string
    }
}

export interface AuthorsNote {
    content: string
    insertPosition?:
        | 'before_char_defs'
        | 'after_char_defs'
        | 'before_scenario'
        | 'after_scenario'
        | 'before_example_messages'
        | 'after_example_messages'
    insertDepth?: number
    insertFrequency?: number
}

export function isRoleBook(obj: unknown): obj is RoleBook {
    return (
        typeof obj === 'object' &&
        obj !== null &&
        'keywords' in obj &&
        'content' in obj
    )
}

export function isRoleBookConfig(obj: unknown): obj is RoleBookConfig {
    return !isRoleBook(obj) && typeof obj === 'object' && obj !== null
}
