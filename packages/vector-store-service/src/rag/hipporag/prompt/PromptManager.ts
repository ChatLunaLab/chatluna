import { BaseChatPromptTemplate } from '@langchain/core/prompts'

import './templates/ircot_hotpotqa'
import './templates/ircot_openbookqa'

export const PROMPT_LIST = new Map<string, BaseChatPromptTemplate>()

export function renderPromptTemplate(
    templateName: string,
    variables: Parameters<BaseChatPromptTemplate['formatMessages']>[0]
) {
    const prompt = PROMPT_LIST.get(templateName)
    if (!prompt) {
        throw new Error(`Prompt ${templateName} not found`)
    }
    return prompt.formatMessages(variables)
}

export function addPromptTemplate(
    templateName: string,
    prompt: BaseChatPromptTemplate
) {
    PROMPT_LIST.set(templateName, prompt)
}
