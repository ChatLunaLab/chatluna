import { PromptTemplate } from '@langchain/core/prompts'
import { AIMessage, type UsageMetadata } from '@langchain/core/messages'
import { ChatLunaLLMChain } from 'koishi-plugin-chatluna/llm-core/chain/base'
import { ChatLunaChatModel } from 'koishi-plugin-chatluna/llm-core/platform/model'
import { getMessageContent } from 'koishi-plugin-chatluna/utils/string'

export interface CompressChunkResult {
    text: string
    usageMetadata?: UsageMetadata
}

const COMPRESS_PROMPT =
    PromptTemplate.fromTemplate(`You are a helpful AI assistant tasked with summarizing conversations.

When asked to summarize, provide a detailed but concise summary of the conversation.
Focus on information that would be helpful for continuing the conversation, including:
- What was done
- What is currently being worked on
- Which files are being modified
- What needs to be done next
- Key user requests, constraints, or preferences that should persist
- Important technical decisions and why they were made
- Tool calls that were made and their results (summarize the key outcomes)

Additional user instructions for this compression:
{instruction}

Some old tool result messages may say that the original tool output expired and was removed.
Treat those as intentional retention placeholders, not as meaningful tool output.

Your summary should be comprehensive enough to provide context but concise enough to be quickly understood.

Do not respond to any questions in the conversation, only output the summary.

Conversation:
{conversation_chunk}`)

export async function compressChunk(
    model: ChatLunaChatModel,
    transcript: string,
    conversationId: string,
    signal?: AbortSignal,
    instruction?: string
): Promise<CompressChunkResult | null> {
    const trimmed = transcript?.trim()

    if (!trimmed) {
        return null
    }

    const chain = new ChatLunaLLMChain({ llm: model, prompt: COMPRESS_PROMPT })

    const result = await chain.invoke({
        conversation_chunk: trimmed,
        instruction: instruction?.trim() || 'None',
        id: conversationId,
        stream: false,
        signal
    })

    const rawMessage = (result['message'] ?? null) as AIMessage | null

    const text =
        (result['text'] ?? '').toString().trim() ||
        (rawMessage ? getMessageContent(rawMessage.content).trim() : '')

    if (!text) {
        return null
    }

    return {
        text,
        usageMetadata: rawMessage?.usage_metadata
    }
}
