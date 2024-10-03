import {
    AIMessage,
    BaseMessage,
    HumanMessage,
    SystemMessage
} from '@langchain/core/messages'
import { load } from 'js-yaml'
import { logger } from 'koishi-plugin-chatluna'

export interface PresetTemplate {
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
    }
    config: {
        longMemoryPrompt?: string
        loreBooksPrompt?: string
        longMemoryExtractPrompt?: string
    }
}

export function loadPreset(rawText: string): PresetTemplate {
    try {
        return loadYamlPreset(rawText)
    } catch {
        return loadTxtPreset(rawText)
    }
}

function loadYamlPreset(rawText: string): PresetTemplate {
    const rawJson = load(rawText) as RawPreset

    let loreBooks: PresetTemplate['loreBooks'] | undefined = {
        items: []
    }

    if (rawJson.word_roles) {
        const config = rawJson.word_roles.find(
            isRoleBookConfig
        ) as RoleBookConfig

        const items = rawJson.word_roles.filter(isRoleBook)

        loreBooks = {
            ...config,
            items
        }
    } else {
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        loreBooks = undefined
    }
    return {
        triggerKeyword: rawJson.keywords,
        rawText,
        messages: rawJson.prompts.map((message) => {
            if (message.role === 'assistant') {
                return new AIMessage(message.content)
            } else if (message.role === 'user') {
                return new HumanMessage(message.content)
            } else if (message.role === 'system') {
                return new SystemMessage(message.content)
            } else {
                throw new Error(`Unknown role: ${message.role}`)
            }
        }),
        formatUserPromptString: rawJson.format_user_prompt,
        loreBooks,
        config: rawJson.config ?? {}
    }
}

function loadTxtPreset(rawText: string): PresetTemplate {
    const triggerKeyword: string[] = []
    const messages: BaseMessage[] = []

    logger?.warn(
        // eslint-disable-next-line max-len
        'The Text Preset is deprecated, Will be removed in the 1.0 release. Please see https://chatluna.chat/guide/preset-system/introduction.html for use yaml preset'
    )

    // split like markdown paragraph
    // 傻逼CRLF
    const chunks = rawText
        // remove comment line (#)
        .replace(/#.*\r?\n/g, '')
        .replace(/\r\n/g, '\n')
        .split(/\n\n/)

    let formatUserPromptString = '{prompt}'

    for (const chunk of chunks) {
        // regex match [key]: [value]
        // the : can in value, but not in key
        const match = chunk.match(/^\s*([a-zA-Z_]+)\s*:\s*(.*)$/s)

        if (!match) {
            continue
        }

        const role = match[1].trim()
        const content = match[2]

        //   logger.debug(`role: ${role}, content: ${content}`)

        if (role === 'keyword') {
            triggerKeyword.push(
                ...content.split(',').map((keyword) => keyword.trim())
            )
        } else if (role === 'format_user_prompt') {
            formatUserPromptString = content.trim()
        } else if (role === 'assistant' || role === 'ai' || role === 'model') {
            messages.push(new AIMessage(content.trim()))
        } else if (role === 'user' || role === 'human') {
            messages.push(new HumanMessage(content.trim()))
        } else if (role === 'system') {
            messages.push(new SystemMessage(content.trim()))
        } else {
            throw new Error(`Unknown role: ${role}`)
        }
    }

    if (triggerKeyword.length === 0) {
        throw new Error('No trigger keyword found')
    }

    if (messages.length === 0) {
        throw new Error('No preset messages found')
    }

    return {
        rawText,
        triggerKeyword,
        messages,
        formatUserPromptString,
        config: {}
    }
}

export function formatPresetTemplate(
    presetTemplate: PresetTemplate,
    inputVariables: Record<string, string>,
    returnVariables: boolean = false
): BaseMessage[] | [BaseMessage[], string[]] {
    const variables: string[] = []

    presetTemplate.messages.concat().forEach((message) => {
        message.content = formatPresetTemplateString(
            message.content as string,
            inputVariables,
            variables
        )
    })

    if (returnVariables) {
        return [presetTemplate.messages, variables]
    }

    return presetTemplate.messages
}

export function formatPresetTemplateString(
    rawString: string,
    inputVariables: Record<string, string>,
    variables: string[] = []
): string {
    // replace all {var} with inputVariables[var]
    return rawString.replace(/{(\w+)}/g, (_, varName: string) => {
        variables.push(varName)
        return inputVariables[varName] || `{${varName}}`
    })
}

export interface RawPreset {
    keywords: string[]
    prompts: {
        role: 'user' | 'system' | 'assistant'
        content: string
    }[]
    format_user_prompt?: string
    word_roles?: (
        | {
              scanDepth?: number
              tokenLimit?: number
              recursiveScan?: boolean
              maxRecursionDepth?: number
          }
        | {
              name: string
              keywords: (string | RegExp)[]
              content: string
              recursiveScan?: boolean
              matchWholeWord?: boolean
              caseSensitive?: boolean
          }
    )[]
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
}

export type RoleBookConfig = Omit<PresetTemplate['loreBooks'], 'items'>

function isRoleBook(obj: unknown): obj is RoleBook {
    return (
        typeof obj === 'object' &&
        obj !== null &&
        'keywords' in obj &&
        'content' in obj
    )
}

function isRoleBookConfig(obj: unknown): obj is RoleBookConfig {
    return !isRoleBook(obj) && typeof obj === 'object' && obj !== null
}
