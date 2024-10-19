import {
    AIMessage,
    BaseMessage,
    BaseMessageFields,
    HumanMessage,
    SystemMessage
} from '@langchain/core/messages'
import { load } from 'js-yaml'
import { logger } from 'koishi-plugin-chatluna'
import {
    isRoleBook,
    isRoleBookConfig,
    PresetTemplate,
    RawPreset,
    RoleBookConfig
} from './type'

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

    let authorsNote: PresetTemplate['authorsNote'] | undefined

    if (rawJson.world_lores) {
        const config = rawJson.world_lores.find(
            isRoleBookConfig
        ) as RoleBookConfig

        const items = rawJson.world_lores.filter(isRoleBook).map((item) => ({
            ...item,
            keywords: Array.isArray(item.keywords)
                ? item.keywords
                : [item.keywords]
        }))

        loreBooks = {
            ...config,
            items
        }
    } else {
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        loreBooks = undefined
    }

    if (rawJson.authors_note) {
        authorsNote = rawJson.authors_note
        authorsNote.insertFrequency = authorsNote.insertFrequency ?? 0
    }

    return {
        triggerKeyword: rawJson.keywords,
        rawText,
        messages: rawJson.prompts.map((message) => {
            const fields = {
                additional_kwargs: {
                    typr: message.type
                },
                content: message.content
            } satisfies BaseMessageFields

            if (message.role === 'assistant') {
                return new AIMessage(fields)
            } else if (message.role === 'user') {
                return new HumanMessage(fields)
            } else if (message.role === 'system') {
                return new SystemMessage(fields)
            } else {
                throw new Error(`Unknown role: ${message.role}`)
            }
        }),
        formatUserPromptString: rawJson.format_user_prompt,
        loreBooks,
        authorsNote,
        knowledge: rawJson?.knowledge,
        version: rawJson?.version,
        config: rawJson.config ?? {}
    }
}

function loadTxtPreset(rawText: string): PresetTemplate {
    const triggerKeyword: string[] = []
    const messages: BaseMessage[] = []

    logger?.warn(
        'TXT Preset is deprecated and will be removed in 1.0. ' +
            'Please migrate to YAML preset format. ' +
            'For more migrate information, visit: https://chatluna.chat/guide/preset-system/introduction.html'
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

export * from './format'
export * from './type'
