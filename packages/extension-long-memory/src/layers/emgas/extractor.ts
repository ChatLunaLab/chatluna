import YAML from 'js-yaml'
import { ComputedRef } from 'koishi-plugin-chatluna'
import { ChatLunaChatModel } from 'koishi-plugin-chatluna/llm-core/platform/model'
import { getMessageContent } from 'koishi-plugin-chatluna/utils/string'
import { ExtractedGraphElements } from './types'

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

const STOP_WORDS = new Set([
    'a',
    'an',
    'and',
    'are',
    'as',
    'at',
    'be',
    'by',
    'for',
    'from',
    'how',
    'in',
    'is',
    'it',
    'of',
    'on',
    'or',
    'that',
    'the',
    'their',
    'they',
    'this',
    'to',
    'with',
    '用户',
    '我们',
    '你们',
    '他们',
    '以及',
    '但是',
    '如果',
    '因为',
    '所以'
])

function isAscii(text: string): boolean {
    return Array.from(text).every((char) => char.charCodeAt(0) <= 0x7f)
}

function format(items: unknown[]): string[] {
    return items
        .map((item) => String(item).trim().replace(/\s+/g, ' '))
        .filter(Boolean)
        .map((item) => (isAscii(item) ? item.toLowerCase() : item))
}

function extractLocal(text: string): ExtractedGraphElements {
    const counts = new Map<string, number>()
    const groups: string[] = []

    for (const item of text.match(
        /[A-Za-z][A-Za-z0-9+#./-]{1,}|[\u3400-\u9fff]{2,}/g
    ) ?? []) {
        if (/^[A-Za-z]/.test(item)) {
            const word = item.toLowerCase()
            if (STOP_WORDS.has(word)) {
                continue
            }
            counts.set(word, (counts.get(word) ?? 0) + 1)
            if (word.length >= 4) {
                groups.push(word)
            }
            continue
        }

        if (item.length >= 2) {
            groups.push(item.length > 12 ? item.slice(0, 12) : item)
        }

        if (item.length <= 8) {
            counts.set(item, (counts.get(item) ?? 0) + 1)
            continue
        }

        for (let i = 0; i < item.length - 1; i++) {
            const word = item.slice(i, i + 2)
            counts.set(word, (counts.get(word) ?? 0) + 1)
        }
    }

    const concepts = Array.from(counts.entries())
        .sort((a, b) => b[1] - a[1] || b[0].length - a[0].length)
        .map(([item]) => item)
        .slice(0, 12)

    const topics = Array.from(new Set(format(groups)))
        .filter((item) => !STOP_WORDS.has(item))
        .slice(0, 3)

    return {
        concepts,
        topics: topics.length > 0 ? topics : concepts.slice(0, 3)
    }
}

/**
 * Extracts key concepts and topics from a text chunk.
 * It prefers the configured LLM and falls back to local extraction.
 * @param modelRef The configured extractor model.
 * @param text The text to analyze.
 * @returns A promise that resolves to an object containing concepts and topics.
 */
export async function extractGraphElements(
    modelRef: ComputedRef<ChatLunaChatModel | undefined> | undefined,
    text: string
): Promise<ExtractedGraphElements> {
    const model = modelRef?.value
    if (model == null) {
        return extractLocal(text)
    }

    try {
        const prompt = GRAPH_ELEMENTS_EXTRACTION_PROMPT(text)
        const res = await model.invoke(prompt)
        const content = getMessageContent(res.content).trim()

        const yamlMatch = content.match(
            /```(?:ya?ml)?\s*\r?\n([\s\S]*?)\r?\n```/i
        )
        const parsed = YAML.load(yamlMatch?.[1] ?? content) as {
            concepts?: unknown[]
            topics?: unknown[]
        } | null

        if (parsed && typeof parsed === 'object') {
            const concepts = format(
                Array.isArray(parsed.concepts) ? parsed.concepts : []
            )
            const topics = format(
                Array.isArray(parsed.topics) ? parsed.topics : []
            )

            if (concepts.length > 0 || topics.length > 0) {
                return {
                    concepts,
                    topics: topics.length > 0 ? topics : concepts.slice(0, 3)
                }
            }
        }

        return extractLocal(text)
    } catch {
        return extractLocal(text)
    }
}
