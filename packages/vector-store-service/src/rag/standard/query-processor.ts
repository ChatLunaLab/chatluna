import { BaseMessage } from '@langchain/core/messages'
import { PromptTemplate } from '@langchain/core/prompts'
import { StringOutputParser } from '@langchain/core/output_parsers'
import { ChatLunaChatModel } from 'koishi-plugin-chatluna/llm-core/platform/model'

/**
 * Reformulates query based on conversation history for better retrieval
 */
export async function reformulateQuery(
    query: string,
    history: BaseMessage[],
    llm: ChatLunaChatModel
): Promise<string> {
    if (!history.length) return query

    const recentHistory = history.slice(-20) // Limit context window

    // eslint-disable-next-line max-len
    const template = `Given the following conversation and a follow up question, rephrase the follow up question to be a standalone question, in its original language.

Chat History:
{chat_history}

Follow Up Input: {question}
Standalone question:`

    const prompt = PromptTemplate.fromTemplate(template)
    const parser = new StringOutputParser()

    const chatHistory = recentHistory
        .map((msg) => `${msg.getType()}: ${msg.content}`)
        .join('\n')

    try {
        const chain = prompt.pipe(llm).pipe(parser)
        const reformulated = await chain.invoke({
            chat_history: chatHistory,
            question: query
        })

        return reformulated.trim() || query
    } catch {
        return query // Fallback to original query on error
    }
}
