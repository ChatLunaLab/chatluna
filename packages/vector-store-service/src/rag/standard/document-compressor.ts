import { Document } from '@langchain/core/documents'
import { PromptTemplate } from '@langchain/core/prompts'
import { StringOutputParser } from '@langchain/core/output_parsers'
import { ChatLunaChatModel } from 'koishi-plugin-chatluna/llm-core/platform/model'

class NoOutputParser extends StringOutputParser {
    constructor(private noOutputStr: string) {
        super()
    }

    async parse(text: string): Promise<string> {
        const parsed = await super.parse(text)
        return parsed.trim() === this.noOutputStr || !parsed.trim()
            ? this.noOutputStr
            : parsed
    }
}

/**
 * Compresses documents using LLM to extract only relevant content
 */
export async function compressDocuments(
    documents: Document[],
    query: string,
    llm: ChatLunaChatModel
): Promise<Document[]> {
    if (!documents.length) return []

    const noOutputStr = '<NO_OUTPUT>'
    // eslint-disable-next-line max-len
    const template = `Given the following question and context, extract any part of the context *AS IS* that is relevant to answer the question. If none of the context is relevant return {no_output_str}.

Remember, *DO NOT* edit the extracted parts of the context.

> Question: {question}
> Context:
>>>
{context}
>>>
Extracted relevant parts:`

    const prompt = PromptTemplate.fromTemplate(template)
    const parser = new NoOutputParser(noOutputStr)

    const compressDocument = async (
        doc: Document
    ): Promise<Document | null> => {
        try {
            const chain = prompt.pipe(llm).pipe(parser)
            const result = await chain.invoke({
                question: query,
                context: doc.pageContent,
                no_output_str: noOutputStr
            })

            if (result !== noOutputStr) {
                return new Document({
                    pageContent: result,
                    metadata: doc.metadata
                })
            }
            return null
        } catch {
            return doc // Keep original on error
        }
    }

    const chunkSize = 6
    const compressed: Document[] = []

    for (let i = 0; i < documents.length; i += chunkSize) {
        const chunk = documents.slice(i, i + chunkSize)
        const results = await Promise.all(chunk.map(compressDocument))

        compressed.push(
            ...results.filter((doc): doc is Document => doc !== null)
        )
    }

    return compressed
}
