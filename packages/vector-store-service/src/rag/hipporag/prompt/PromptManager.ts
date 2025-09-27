import { BaseChatPromptTemplate } from '@langchain/core/prompts'

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

export async function registerAllPrompts(): Promise<void> {
    await Promise.all([
        import('./templates/ircot_hotpotqa'),
        import('./templates/ircot_musique'),
        import('./templates/ner'),
        import('./templates/ner_query'),
        import('./templates/rag_qa_musique'),
        import('./templates/triple_extraction')
    ])
}
