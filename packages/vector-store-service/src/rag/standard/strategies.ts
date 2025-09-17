import { Document } from '@langchain/core/documents'
import { BaseMessage } from '@langchain/core/messages'
import { ChatLunaSaveableVectorStore } from 'koishi-plugin-chatluna/llm-core/vectorstores'
import { reformulateQuery } from './query-processor'
import { compressDocuments } from './document-compressor'
import { ChatLunaChatModel } from 'koishi-plugin-chatluna/llm-core/platform/model'

export type RetrievalStrategy = 'fast' | 'regenerate' | 'contextual-compression'

export interface RetrievalContext {
    query: string
    documents: Document[]
    history?: BaseMessage[]
    llm?: ChatLunaChatModel
    vectorStore?: ChatLunaSaveableVectorStore
    k?: number
}

/**
 * Fast strategy: returns documents as-is
 */
export async function fastStrategy(
    context: RetrievalContext
): Promise<Document[]> {
    return context.documents
}

/**
 * Regenerate strategy: reformulates query and re-searches vector store
 */
export async function regenerateStrategy(
    context: RetrievalContext
): Promise<Document[]> {
    const { query, history, llm, vectorStore, k } = context

    if (!llm || !history?.length || !vectorStore) {
        return context.documents
    }

    const reformulatedQuery = await reformulateQuery(query, history, llm)

    // Re-search with reformulated query
    const newResults = await vectorStore.similaritySearchWithScore(
        reformulatedQuery,
        k ?? 5
    )
    return newResults.map(([doc]) => doc)
}

/**
 * Contextual compression strategy: filters documents using LLM
 */
export async function contextualCompressionStrategy(
    context: RetrievalContext
): Promise<Document[]> {
    const { query, documents, llm } = context

    if (!llm) {
        return documents
    }

    return compressDocuments(documents, query, llm)
}

export const STRATEGIES = {
    fast: fastStrategy,
    regenerate: regenerateStrategy,
    'contextual-compression': contextualCompressionStrategy
} as const
