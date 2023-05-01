import { SimpleMessage } from './types';
import { createLogger } from './utils/logger';


const logger = createLogger('@dingyi222666/chathub-copilothub-adapter/preset')

export class Preset {

}

export interface PresetMessage extends SimpleMessage { }

export class PresetTemplate {

    constructor(public readonly triggerKeyword: string[], public readonly messages: PresetMessage[]) {}


    format(inputVaraibles: Record<string, string>): SimpleMessage[] {
        return this.messages.map((message) => {
            return {
                content: this.formatString(message.content, inputVaraibles),
                role: message.role,
                sender: message.sender,
            }
        })
    }

    private formatString(rawString: string, inputVaraibles: Record<string, string>): string {
        return rawString.replace(/{(\w+)}/g, function (match, key) {
            return inputVaraibles[key] || match;
        });
    }
}

export function loadPreset(rawText: string): PresetTemplate {
    const triggerKeyword: string[] = []
    const messages: SimpleMessage[] = []

    // split like markdown paragraph
    // 傻逼CRLF
    const chunks = rawText
    .replace(/\r\n/g, '\n')
    .split(/\n\n/)

    logger.debug(`rawText: ${rawText}`)

    const roleMappping = {
        "system": "system",
        "assistant": "model",
        "user": "user"
    }

    for (const chunk of chunks) {
        let [role, content] = chunk.split(':')
        role = role.trim().toLowerCase()

        logger.debug(`role: ${role}, content: ${content}`)
        
        if (role == "keyword") {
            triggerKeyword.push(...content.split(',').map((keyword) => keyword.trim()))
        } else {
            messages.push({
                role: roleMappping[role.trim()] as 'user' | 'system' | 'model',
                content: content.trim()
            })
        }
    }

    if (triggerKeyword.length == 0) {
        throw new Error("No trigger keyword found")
    }

    if (messages.length == 0) {
        throw new Error("No message found")
    }

    return new PresetTemplate(triggerKeyword, messages)
}

