import { ChatLunaChatModel } from 'koishi-plugin-chatluna/llm-core/platform/model'
import YAML from 'js-yaml'
import { ComputedRef } from 'koishi-plugin-chatluna'
import { getMessageContent } from 'koishi-plugin-chatluna/utils/string'
import {
    ChatLunaError,
    ChatLunaErrorCode
} from 'koishi-plugin-chatluna/utils/error'

export interface ExtractedGraphElements {
    concepts: string[]
    topics: string[]
}

const GRAPH_ELEMENTS_EXTRACTION_PROMPT = (text: string) => `
You are an expert in knowledge extraction. Your task is to analyze the following text to identify key concepts and overarching topics.

Text to analyze:
"""
${text}
"""

Respond with a single, valid YAML block with two keys: 'concepts' and 'topics'.

Guidelines:
1.  **concepts**: A list of the most important keywords, and named entities from the text. Use the base form or most common form.
2.  **topics**: A list of 1-3 higher-level topics that categorize the concepts. These should be broader categories.
3.  If no meaningful data can be extracted, return empty lists for both keys.

Example:
Text: "The user is asking about setting up a new React project with Vite. They are having trouble with the HMR (Hot Module Replacement) configuration."

YAML Output:
\`\`\`yaml
concepts:
  - React
  - Vite
  - HMR
  - project setup
topics:
  - Frontend Development
  - Build Tools
\`\`\`

YAML Output:
`

/**
 * Extracts key concepts and topics from a text chunk using an LLM.
 * @param ctx The Koishi context.
 * @param config The plugin configuration.
 * @param text The text to analyze.
 * @returns A promise that resolves to an object containing concepts and topics.
 */
export async function extractGraphElements(
    modelRef: ComputedRef<ChatLunaChatModel>,
    text: string
): Promise<ExtractedGraphElements> {
    if (!modelRef.value) {
        throw new ChatLunaError(
            ChatLunaErrorCode.MODEL_NOT_FOUND,
            new Error(
                'LLM-based extractor is disabled. Cannot extract graph elements.'
            )
        )
    }

    const model = modelRef.value

    try {
        const prompt = GRAPH_ELEMENTS_EXTRACTION_PROMPT(text)
        const res = await model.invoke(prompt)
        const content = getMessageContent(res.content)

        const yamlMatch = content.match(
            /```(?:ya?ml)?\s*\r?\n([\s\S]*?)\r?\n```/i
        )
        if (yamlMatch && yamlMatch[1]) {
            const parsed = YAML.load(yamlMatch[1]) as {
                concepts: string[]
                topics: string[]
            }
            return {
                concepts: []
                    .concat(parsed.concepts || [])
                    .map((item) => String(item).trim())
                    .filter(Boolean),
                topics: []
                    .concat(parsed.topics || [])
                    .map((item) => String(item).trim())
                    .filter(Boolean)
            }
        }

        throw new ChatLunaError(
            ChatLunaErrorCode.MODEL_RESPONSE_IS_EMPTY,
            new Error(
                'LLM did not return a valid YAML for graph element extraction.'
            )
        )
    } catch (error) {
        if (error instanceof ChatLunaError) {
            throw error
        }
        throw new ChatLunaError(
            ChatLunaErrorCode.API_REQUEST_FAILED,
            error as Error
        )
    }
}
