import { Context } from 'koishi'
import { ChatLunaSaveableVectorStore } from 'koishi-plugin-chatluna/llm-core/vectorstores'
import { Document } from '@langchain/core/documents'
import { BaseMessage } from '@langchain/core/messages'
import { Embeddings } from '@langchain/core/embeddings'

/**
 * Abstract base class for RAG (Retrieval Augmented Generation) retrieval operations.
 * Provides a unified interface for document management and similarity search across different vector stores.
 *
 * Following LangChain naming conventions, this class focuses on the "Retrieval" aspect of RAG.
 */
export abstract class BaseRAGRetriever<
    T extends RetrieverConfig = RetrieverConfig
> {
    protected _vectorStore: ChatLunaSaveableVectorStore
    protected _initialized: boolean = false

    constructor(
        public ctx: Context,
        protected config: T
    ) {}

    /**
     * Initialize the retriever and its underlying vector store.
     * Must be called before using any retrieval operations.
     */
    abstract initialize(): Promise<void>

    /**
     * Add pre-chunked documents to the vector store for future retrieval.
     *
     * @param documents Array of chunked documents to add
     * @param options Additional options like custom IDs
     * @returns Promise resolving to array of document IDs
     */
    abstract addDocuments(
        documents: Document[],
        options?: AddDocumentsOptions
    ): Promise<string[]>

    /**
     * Perform similarity search to retrieve relevant documents.
     * This is the core "R" (Retrieval) operation in RAG.
     *
     * @param query Search query string
     * @param options Search configuration options
     * @param history Optional conversation history for context-aware retrieval
     * @returns Promise resolving to array of relevant documents
     */
    abstract similaritySearch(
        query: string,
        options?: SearchOptions,
        history?: BaseMessage[]
    ): Promise<Document[]>

    /**
     * List all documents in the vector store with optional filtering.
     *
     * @param options Filtering and pagination options
     * @returns Promise resolving to array of document metadata
     */
    abstract listDocuments(options?: ListDocumentsOptions): Promise<Document[]>

    /**
     * Delete documents from the vector store.
     *
     * @param options Deletion options (by IDs, filter, or deleteAll)
     * @returns Promise resolving when deletion is complete
     */
    abstract deleteDocuments(options: DeleteDocumentsOptions): Promise<void>

    /**
     * Get statistics about the current vector store state.
     *
     * @returns Promise resolving to retriever statistics
     */
    abstract getStats(): Promise<RetrieverStats>

    /**
     * Check if the retriever is properly initialized and ready for operations.
     */
    isInitialized(): boolean {
        return this._initialized
    }

    /**
     * Clean up resources and close connections.
     */
    abstract dispose(): Promise<void>
}

/**
 * Configuration options for BaseRAGRetriever initialization.
 */
export interface RetrieverConfig {
    /**  Embeddings model for generating embeddings */
    embeddings: Embeddings
    /** Key identifier for the vector store */
    vectorStoreKey?: string
    /** Maximum number of documents to return in search */
    maxResults?: number
    /** Default similarity threshold for filtering results */
    similarityThreshold?: number
    /** Additional provider-specific configuration */
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    providerConfig?: Record<string, any>
}

/**
 * Options for adding documents to the retriever.
 */
export interface AddDocumentsOptions {
    /** Custom IDs for the documents (optional) */
    ids?: string[]
    /** Batch size for processing large document sets */
    batchSize?: number
    /** Metadata to add to all documents in this batch */
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    metadata?: Record<string, any>
}

/**
 * Options for similarity search operations.
 */
export interface SearchOptions {
    /** Number of documents to retrieve (default: from config) */
    k?: number
    /** Minimum similarity score threshold */
    threshold?: number
}

/**
 * Options for listing documents.
 */
export interface ListDocumentsOptions {
    /** Maximum number of documents to return */
    limit?: number
    /** Offset for pagination */
    offset?: number

    /** Include document content preview */
    includePreview?: boolean
    /** Sort by field (e.g., 'createdAt', 'updatedAt') */
    sortBy?: string
    /** Sort order */
    sortOrder?: 'asc' | 'desc'
}

/**
 * Options for deleting documents.
 */
export interface DeleteDocumentsOptions {
    /** Specific document IDs to delete */
    ids?: string[]
    /** Delete all documents (use with caution) */
    deleteAll?: boolean
}

/**
 * Statistics about the retriever's current state.
 */
export interface RetrieverStats {
    /** Total number of documents in the vector store */
    totalDocuments: number
    /** Total size of stored data (in bytes, if available) */
    totalSize?: number
    /** Vector store type/provider */
    vectorStoreType: string
    /** Last update timestamp */
    lastUpdated?: Date
    /** Additional provider-specific statistics */
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    providerStats?: Record<string, any>
}
