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
                    : getMessageContent(m.content)

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
    const preset = chatInterface.preset.value
    const input = (
        preset.config?.longMemoryExtractPrompt ?? ENHANCED_MEMORY_PROMPT
    ).replaceAll('{user_input}', chatHistory)

    const extractMemory = async () => {
        const result = await model.value.invoke(input)
        const content = getMessageContent(result.content)

        const { preview } = createSecureLogMessage(content)
        logger?.debug(`Long memory extract model result: ${preview}`)

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
            if (Array.isArray(memories)) {
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

const ENHANCED_MEMORY_PROMPT = `You are a Memory Extraction expert. Analyze a segment of multi-turn conversation history and extract ONLY truly core, long-term information worth remembering.

# Conversation History
"""
{user_input}
"""

# Core Principle
Most conversations contain NO long-term value. Extract ONLY information that should be remembered for months or years across multiple conversations. Be highly selective.

# What to Extract

## HIGH Priority (Extract these)
- **User preferences & dislikes**: Long-term likes/dislikes (food, music, activities, style preferences)
- **Personal identity**: Name, age, location, occupation, education, family structure
- **Core interests & hobbies**: Frequently discussed topics, passions, regular activities
- **Important habits**: Daily routines, behavioral patterns, lifestyle choices
- **Skills & expertise**: Professional skills, technical abilities, areas of knowledge
- **Values & beliefs**: Life philosophy, principles, deeply-held opinions
- **Relationships**: Important people in user's life (family, friends, pets)

## DO NOT Extract (Ignore these)
- Short-term tasks or TODO items
- Immediate questions or requests for help
- Greetings, acknowledgments, or conversational fillers
- Temporary emotional states or current conditions
- One-time events or activities (unless culturally/personally significant)
- Technical troubleshooting or debugging discussions
- Meta-discussion about the conversation itself

# Quality Standards

1. Each memory must be **standalone** and understandable without context
2. Write in complete, declarative sentences
3. Only extract patterns that appear repeatedly or are explicitly important
4. Output language must match input language
5. **Default to extracting nothing** - when uncertain, skip it

# Output Format

Return a single YAML code block:

\`\`\`yaml
memories:
  - content: "<standalone memory sentence>"
    type: "<category>"
    importance: <1-10>
\`\`\`

If no valuable long-term information exists, return empty list:
\`\`\`yaml
memories: []
\`\`\`

## Memory Types
- \`preference\`: User's likes/dislikes
- \`personal\`: Identity and biographical information
- \`interest\`: Hobbies and topics of passion
- \`habit\`: Regular routines and patterns
- \`skill\`: Abilities and expertise
- \`relationship\`: Information about important people
- \`factual\`: Other objective facts worth remembering

## Importance Scoring
- **1-3**: Minor detail or casual preference
- **4-6**: Moderately important, useful to remember
- **7-8**: Very important personal information
- **9-10**: Critical identity information

# Examples

**Example 1 - Multi-turn conversation revealing preferences:**

Conversation:
"""
User: 我今天想吃火锅
Assistant: 好的，什么口味的？
User: 当然是麻辣的，我是四川人，从小就吃辣
Assistant: 了解了
User: 甜食我可不行，吃了会过敏
"""

\`\`\`yaml
memories:
  - content: "用户喜欢吃辣，尤其是麻辣火锅"
    type: "preference"
    importance: 6
  - content: "用户是四川人，从小生活在四川"
    type: "personal"
    importance: 7
  - content: "用户对甜食过敏，不能吃甜食"
    type: "personal"
    importance: 8
\`\`\`

**Example 2 - Technical discussion (no long-term value):**

Conversation:
"""
User: 帮我看看这个Python代码为什么报错
Assistant: 是缩进问题
User: 哦好的，我修改一下
Assistant: 还有问题吗？
User: 没了，谢谢
"""

\`\`\`yaml
memories: []
\`\`\`

**Example 3 - Revealing interests over multiple turns:**

Conversation:
"""
User: I spent the weekend hiking again
Assistant: Where did you go?
User: Mount Rainier, I try to go every month
Assistant: That's quite regular
User: Yeah, I've been doing it for 3 years now. Photography is my other hobby, I always bring my camera
"""

\`\`\`yaml
memories:
  - content: "The user regularly goes hiking, approximately once per month for the past 3 years"
    type: "interest"
    importance: 7
  - content: "The user enjoys photography and often combines it with hiking"
    type: "interest"
    importance: 6
\`\`\`

**Example 4 - Casual chat (ignore):**

Conversation:
"""
User: 今天天气不错
Assistant: 是的
User: 我午饭吃了面条
Assistant: 好的
"""

\`\`\`yaml
memories: []
\`\`\`

**Example 5 - Professional identity revealed:**

Conversation:
"""
User: As a backend engineer, I think this design has issues
Assistant: What specifically?
User: The database schema isn't normalized. I've been doing this for 5 years
Assistant: I see
User: I mainly work with Go and PostgreSQL at my company
"""

\`\`\`yaml
memories:
  - content: "The user is a backend engineer with 5 years of experience"
    type: "personal"
    importance: 8
  - content: "The user primarily works with Go programming language and PostgreSQL database"
    type: "skill"
    importance: 7
\`\`\`

# Your Output
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
