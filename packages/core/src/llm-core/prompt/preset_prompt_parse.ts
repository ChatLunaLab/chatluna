import { AIChatMessage, BaseChatMessage, HumanChatMessage, SystemChatMessage } from 'langchain/schema'

export interface PresetTemplate {
    triggerKeyword: string[],
    rawText: string
    messages: BaseChatMessage[],
    formatUserPromptString?: string
}

export function loadPreset(rawText: string): PresetTemplate {
    const triggerKeyword: string[] = []
    const messages: BaseChatMessage[] = []

    // split like markdown paragraph
    // 傻逼CRLF
    const chunks = rawText
        // remove comment line (#)
        .replace(/#.*\r?\n/g, '')
        .replace(/\r\n/g, '\n')
        .split(/\n\n/)

    let formatUserPromptString = "{prompt}"

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

        if (role === "keyword") {
            triggerKeyword.push(...content.split(',').map((keyword) => keyword.trim()))
        } else if (role === "format_user_prompt") {
            formatUserPromptString = content.trim()
        } else if (role === "assistant" || role === "ai" || role === "model") {
            messages.push(new AIChatMessage(content.trim()))
        } else if (role === "user" || role === "human") {
            messages.push(new HumanChatMessage(content.trim()))
        } else if (role === "system") {
            messages.push(new SystemChatMessage(content.trim()))
        } else {
            throw new Error(`Unknown role: ${role}`)
        }
    }

    if (triggerKeyword.length === 0) {
        throw new Error("No trigger keyword found")
    }

    if (messages.length === 0) {
        throw new Error("No preset messages found")
    }

    return {
        rawText,
        triggerKeyword,
        messages,
        formatUserPromptString
    }
}

export function formatPresetTemplate(
    presetTemplate: PresetTemplate, inputVaraibles: Record<string, string>): BaseChatMessage[] {
    presetTemplate.messages.forEach((message) => {
        message.text = formatPresetTemplateString(message.text, inputVaraibles)
    })

    return presetTemplate.messages
}

export function formatPresetTemplateString(rawString: string, inputVaraibles: Record<string, string>): string {
    // replace all {var} with inputVaraibles[var]
    return rawString.replace(/{(\w+)}/g, (_, varName) => {
        return inputVaraibles[varName] || `{${varName}}`
    })
}