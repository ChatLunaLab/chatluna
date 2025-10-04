import {
    AIMessage,
    BaseMessage,
    BaseMessageFields,
    HumanMessage,
    MessageContentComplex,
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
    } catch (e) {
        logger.error(e)
        throw e
    }
}

function createMessage(
    role: string,
    content: string | MessageContentComplex[],
    type?: string
): BaseMessage {
    if (content == null) {
        throw new Error('Content is required')
    }

    const fields: BaseMessageFields = {
        content: typeof content === 'string' ? content.trim() : content,
        additional_kwargs: { type }
    }

    switch (role) {
        case 'assistant':
        case 'ai':
        case 'model':
            return new AIMessage(fields)
        case 'user':
        case 'human':
            return new HumanMessage(fields)
        case 'system':
            return new SystemMessage(fields)
        default:
            throw new Error(`Unknown role: ${role}`)
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

    if (rawJson.authors_note || rawJson['author_notes']) {
        authorsNote = rawJson.authors_note || rawJson['author_notes']
        authorsNote.insertFrequency = authorsNote.insertFrequency ?? 1
        authorsNote.insertPosition = authorsNote.insertPosition ?? 'in_chat'
        authorsNote.insertDepth = authorsNote.insertDepth ?? 0
    }

    return {
        triggerKeyword: rawJson.keywords,
        rawText,
        messages: rawJson.prompts.map((message) =>
            createMessage(message.role, message.content, message.type)
        ),
        formatUserPromptString: rawJson.format_user_prompt,
        loreBooks,
        authorsNote,
        knowledge: rawJson?.knowledge,
        version: rawJson?.version,
        config: rawJson.config ?? {}
    }
}

export const EMPTY_PRESET: PresetTemplate = {
    triggerKeyword: [],
    messages: [],
    rawText: '',
    formatUserPromptString: '',
    loreBooks: undefined,
    authorsNote: undefined,
    knowledge: undefined,
    version: undefined,
    config: {}
}

export * from './type'
