/* eslint-disable max-len */
import { logger } from '..'
import { BaseMessage } from '@langchain/core/messages'
import { ChatInterface } from 'koishi-plugin-chatluna/llm-core/chat/app'
import { EnhancedMemory } from '../types'
import { ComputedRef } from 'koishi-plugin-chatluna'
import { ChatLunaChatModel } from 'koishi-plugin-chatluna/llm-core/platform/model'
import { getMessageContent } from 'koishi-plugin-chatluna/utils/string'
import YAML from 'js-yaml'
import { createHash, randomUUID } from 'crypto'

// Configurable constants for secure logging
const SAFE_LOG_CONTENT_LENGTH = parseInt(
    process.env.CHATLUNA_SAFE_LOG_LENGTH || '150',
    10
)
const LOG_FINGERPRINT_ALGORITHM = 'sha256'

/**
 * Creates a secure log message with truncated content and fingerprint
 * @param content The content to log safely
 * @param maxLength Maximum length of safe content preview (default: SAFE_LOG_CONTENT_LENGTH)
 * @returns Object with safe preview and fingerprint
 */
function createSecureLogMessage(
    content: string,
    maxLength: number = SAFE_LOG_CONTENT_LENGTH
): {
    preview: string
    fingerprint: string
} {
    const truncated =
        content.length > maxLength
            ? content.substring(0, maxLength) + '...'
            : content

    const hash = createHash(LOG_FINGERPRINT_ALGORITHM)
    const fingerprint = hash
        .update(content, 'utf8')
        .digest('hex')
        .substring(0, 16)

    return {
        preview: truncated,
        fingerprint
    }
}

export async function generateNewQuestion(
    model: ComputedRef<ChatLunaChatModel>,
    chatHistory: string,
    question: string
): Promise<string> {
    const result = await model.value.invoke(
        GENERATE_QUESTION_PROMPT(chatHistory, question)
    )

    return getMessageContent(result.content)
}

export async function selectChatHistory(
    messages: BaseMessage[],
    count: number = 10
): Promise<string> {
    if (!messages || messages.length === 0) {
        return ''
    }

    const startIndex = Math.max(0, messages.length - 1 - count * 2)
    const selectedMessages = messages.slice(startIndex, messages.length - 1)

    // 格式化聊天历史
    return selectedMessages
        .map((m) => {
            if (
                m.getType() === 'system' ||
                m.getType() === 'tool' ||
                m.getType() === 'function' ||
                m.getType() === 'ai'
            ) {
                return ''
            }
            const role = m.getType() === 'human' ? 'User' : 'Assistant'

            const content =
                typeof m.content === 'string'
                    ? m.content
                    : JSON.stringify(m.content)

            if (content.trim().length < 1) {
                return ''
            }
            return `${role}: ${content}`
        })
        .join('\n')
}

// 从聊天历史中提取记忆
export async function extractMemoriesFromChat(
    model: ComputedRef<ChatLunaChatModel>,
    chatInterface: ChatInterface,
    chatHistory: string
): Promise<EnhancedMemory[]> {
    const preset = await chatInterface.preset
    const input = (
        preset.config?.longMemoryExtractPrompt ?? ENHANCED_MEMORY_PROMPT
    ).replaceAll('{user_input}', chatHistory)

    const extractMemory = async () => {
        const result = await model.value.invoke(input)
        const content = getMessageContent(result.content)

        const { preview, fingerprint } = createSecureLogMessage(content)
        logger?.debug(
            `Long memory extract model result: ${preview} [fingerprint: ${fingerprint}]`
        )

        try {
            const yamlMatch = content.match(
                /```(?:ya?ml)?\s*\r?\n([\s\S]*?)\r?\n```/i
            )
            if (yamlMatch && yamlMatch[1]) {
                const parsed = YAML.load(yamlMatch[1]) as {
                    memories: EnhancedMemory[]
                }
                if (parsed.memories) {
                    return parsed.memories.map((m) => ({
                        ...m,
                        id: randomUUID()
                    }))
                }
            }
        } catch (e) {
            logger?.debug(`Failed to parse enhanced memories from YAML: `, e)
        }

        // Fallback to simple content parsing
        return []
    }

    let memories: EnhancedMemory[] = []

    for (let i = 0; i < 2; i++) {
        try {
            memories = await extractMemory()
            if (memories && memories.length > 0) {
                break
            }
        } catch (e) {
            logger?.error(e)
            logger?.warn(`Error extracting long memory of ${i} times`)
        }
    }

    if (!memories || memories.length === 0) {
        return []
    }

    return memories
}

const ENHANCED_MEMORY_PROMPT = `You are a Memory Extraction expert. Your task is to analyze the following conversation and extract key memories.

Conversation to analyze:
"""
{user_input}
"""

Respond with a single, valid YAML block containing a list of memory objects under the key "memories".

**Guidelines:**

1.  **Focus:** Extract factual information, user preferences, personal details, and other significant information that should be remembered for future conversations.
2.  **Content:** Each memory's content should be a complete, standalone sentence.
3.  **Exclusions:** Do not include greetings, fillers, or meta-discussion about the conversation itself.
4.  **Language:** The output language must match the input language.
5.  **Empty:** If no meaningful memories can be extracted, return an empty list for the "memories" key.

**Memory Object Structure:**

Each memory object must have three keys:
-   \`content\`: (string) The standalone memory sentence.
-   \`type\`: (string) The category of the memory.
-   \`importance\`: (number) A score from 1-10 indicating how important the memory is.

**Memory Types:**

Categorize each memory into ONE of the following types:
-   \`factual\`: Objective facts.
-   \`preference\`: User likes and dislikes.
-   \`personal\`: Personal details about the user.
-   \`contextual\`: Information relevant to the current conversation context.
-   \`temporal\`: Time-sensitive information.
-   \`task\`: A task or a goal.
-   \`skill\`: User's skills or abilities.
-   \`interest\`: User's hobbies or interests.
-   \`habit\`: User's routines or habits.
-   \`event\`: Information about an event.
-   \`location\`: Location-related information.
-   \`relationship\`: Information about the user's relationships.

**Importance Score:**

Assign an importance score from 1 to 10:
-   **1-3:** Minor detail.
-   **4-6:** Moderately important.
-   **7-9:** Very important.
-   **10:** Critical information that must be remembered.

**Example:**

Conversation: "User: I love hiking, but I don't like hot weather. My birthday is on October 26th."

YAML Output:
\`\`\`yaml
memories:
  - content: "The user loves hiking."
    type: "interest"
    importance: 7
  - content: "The user dislikes hot weather."
    type: "preference"
    importance: 5
  - content: "The user's birthday is on October 26th."
    type: "personal"
    importance: 9
\`\`\`

YAML Output:
`

const GENERATE_QUESTION_PROMPT = (
    chatHistory: string,
    question: string
) => `You are an expert in query optimization. Your task is to generate a concise search query based on a conversation history and a new user question. This query will be used to retrieve relevant information from a long-term memory database.

**Input:**

1.  **Conversation History:**
    """
    ${chatHistory}
    """

2.  **User Question:**
    """
    ${question}
    """

**Instructions:**

1.  **Analyze:** Analyze the history and the new question to understand the user's core information need.
2.  **Generate Query:** Create a new, concise search query that captures the essence of the user's question in the context of the conversation.
3.  **Handle Simple Cases:** If the user's question is a casual greeting (e.g., "hello", "how are you") or a simple question that doesn't require memory lookup, respond with the exact string "[skip]".

**Output Format:**

-   Return only the generated search query as a single line of text.
-   Or, return the exact string "[skip]" if applicable.

**New Search Query:**
`
