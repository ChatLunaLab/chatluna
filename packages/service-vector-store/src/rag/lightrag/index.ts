import { Context } from 'koishi'
import { Document } from '@langchain/core/documents'
import { BaseMessage } from '@langchain/core/messages'
import {
    AddDocumentsOptions,
    BaseRAGRetriever,
    DeleteDocumentsOptions,
    ListDocumentsOptions,
    RetrieverConfig,
    RetrieverStats,
    SearchOptions
} from '../base'

import { chatLunaFetch } from 'koishi-plugin-chatluna/utils/request'
import {
    DeleteDocRequest,
    DeletionResult,
    DocStatus,
    DocumentsRequest,
    EntityExistsResponse,
    EntityUpdateRequest,
    GraphEntity,
    GraphRelation,
    InsertResponse,
    KnowledgeGraph,
    PaginatedDocsResponse,
    PopularLabel,
    QueryDataResponse,
    QueryMode,
    QueryRequest,
    RelationUpdateRequest,
    StatusCountsResponse
} from './type'
import { ChatLunaChatModel } from 'koishi-plugin-chatluna/llm-core/platform/model'

/**
 * LightRAG retriever implementation
 * A lightweight RAG retriever with graph-based retrieval capabilities
 */
export class LightRAGRetriever extends BaseRAGRetriever<LightRAGRetrieverConfig> {
    private _baseUrl: string
    private _apiKey?: string

    constructor(ctx: Context, config: LightRAGRetrieverConfig) {
        super(ctx, config)
        this._baseUrl = config.baseUrl || 'http://localhost:9621'
        this._apiKey = config.apiKey
    }

    async initialize(): Promise<void> {
        if (this._initialized) return

        if (!this._baseUrl) {
            throw new Error('baseUrl is required for LightRAG')
        }

        // Test connection to LightRAG server
        try {
            const response = await chatLunaFetch(`${this._baseUrl}/health`, {
                headers: this._getHeaders()
            })
            if (!response.ok) {
                throw new Error(
                    `Failed to connect to LightRAG server: ${response.statusText}`
                )
            }
        } catch (error) {
            throw new Error(
                `Failed to connect to LightRAG server: ${error.message}`
            )
        }

        this._initialized = true
    }

    private _getHeaders(): HeadersInit {
        const headers: HeadersInit = {
            'Content-Type': 'application/json'
        }
        if (this._apiKey) {
            headers['Authorization'] = `Bearer ${this._apiKey}`
        }
        return headers
    }

    async addDocuments(
        documents: Document[],
        options?: AddDocumentsOptions
    ): Promise<string[]> {
        if (!this._initialized) await this.initialize()

        const response = await chatLunaFetch(
            `${this._baseUrl}/documents/text`,
            {
                method: 'POST',
                headers: this._getHeaders(),
                body: JSON.stringify({
                    file_sources: [],
                    texts: documents.map((doc) => doc.pageContent)
                })
            }
        )

        if (!response.ok) {
            const errorBody = await response.text()
            throw new Error(
                `Failed to add a document: ${response.statusText}. Body: ${errorBody}`
            )
        }
        const result = (await response.json()) as InsertResponse

        return [result.track_id]
    }

    async similaritySearch(
        query: string,
        options?: SearchOptions & {
            filters?: Record<string, unknown>
            include?: string[]
            mode?: QueryMode
        },
        history?: BaseMessage[]
    ): Promise<Document[]> {
        if (!this._initialized) await this.initialize()

        const k = options?.k ?? this.config.maxResults ?? 5

        const requestBody: QueryRequest = {
            query,
            chunk_top_k: k,
            mode: options.mode ?? this.config.defaultQueryMode ?? 'global'
            // The API uses `chunk_top_k` for controlling retrieved documents count
        }

        const response = await chatLunaFetch(`${this._baseUrl}/query/data`, {
            method: 'POST',
            headers: this._getHeaders(),
            body: JSON.stringify(requestBody)
        })

        if (!response.ok) {
            const errorBody = await response.text()
            throw new Error(
                `Similarity search failed: ${response.statusText}. Body: ${errorBody}`
            )
        }

        const result = (await response.json()) as QueryDataResponse

        if (result.status === 'failure') {
            throw new Error(`Similarity search failed: ${result.message}`)
        }

        const returnedDocs: Document[] = []

        if (result.data.chunks && result.data.chunks.length > 0) {
            for (const chunk of result.data.chunks) {
                const metadata = {
                    chunk_id: chunk.chunk_id,
                    reference_id: chunk.reference_id,
                    source: chunk.file_path
                }
                returnedDocs.push(
                    new Document({ pageContent: chunk.content, metadata })
                )
            }
        }

        // Attach entities and relationships to the metadata of the first document
        if (returnedDocs.length > 0) {
            returnedDocs[0].metadata.entities = result.data.entities
            returnedDocs[0].metadata.relationships = result.data.relationships
            returnedDocs[0].metadata.query_metadata = result.metadata
        }

        return returnedDocs
    }

    async listDocuments(
        options?: ListDocumentsOptions & {
            page?: number
            pageSize?: number
            status_filter?: DocStatus
        }
    ): Promise<Document[]> {
        if (!this._initialized) await this.initialize()

        const requestBody: DocumentsRequest = {
            page: options?.page ?? 1,
            page_size: options?.pageSize ?? options?.limit ?? 50,
            status_filter: options?.status_filter,
            sort_field: 'updated_at',
            sort_direction: 'desc'
        }

        const response = await chatLunaFetch(
            `${this._baseUrl}/documents/paginated`,
            {
                method: 'POST',
                headers: this._getHeaders(),
                body: JSON.stringify(requestBody)
            }
        )

        if (!response.ok) {
            const errorBody = await response.text()
            throw new Error(
                `Failed to list documents: ${response.statusText}. Body: ${errorBody}`
            )
        }

        const result = (await response.json()) as PaginatedDocsResponse
        if (result.documents && Array.isArray(result.documents)) {
            return result.documents.map(
                (doc) =>
                    new Document({
                        pageContent: doc.content_summary,
                        metadata: doc
                    })
            )
        }
        return []
    }

    async deleteDocuments(options: DeleteDocumentsOptions): Promise<void> {
        if (!this._initialized) await this.initialize()

        if (options.deleteAll) {
            const response = await chatLunaFetch(`${this._baseUrl}/documents`, {
                method: 'DELETE',
                headers: this._getHeaders()
            })
            if (!response.ok) {
                const errorBody = await response.text()
                throw new Error(
                    `Failed to delete all documents: ${response.statusText}. Body: ${errorBody}`
                )
            }
        } else if (options.ids && options.ids.length > 0) {
            const response = await chatLunaFetch(
                `${this._baseUrl}/documents/delete_document`,
                {
                    method: 'DELETE',
                    headers: this._getHeaders(),
                    body: JSON.stringify({
                        doc_ids: options.ids
                    } as DeleteDocRequest)
                }
            )
            if (!response.ok) {
                const errorBody = await response.text()
                throw new Error(
                    `Failed to delete documents: ${response.statusText}. Body: ${errorBody}`
                )
            }
        }
    }

    async getStats(): Promise<RetrieverStats> {
        if (!this._initialized) await this.initialize()

        const response = await chatLunaFetch(
            `${this._baseUrl}/documents/status_counts`,
            {
                headers: this._getHeaders()
            }
        )

        if (!response.ok) {
            const errorBody = await response.text()
            throw new Error(
                `Failed to get stats: ${response.statusText}. Body: ${errorBody}`
            )
        }

        const stats = (await response.json()) as StatusCountsResponse

        const totalDocuments = Object.values(stats.status_counts).reduce(
            (a, b) => a + b,
            0
        )

        return {
            totalDocuments,
            vectorStoreType: 'LightRAG',
            providerStats: stats.status_counts
        }
    }

    // Graph methods
    async getGraphLabels(): Promise<string[]> {
        if (!this._initialized) await this.initialize()
        const response = await chatLunaFetch(
            `${this._baseUrl}/graph/label/list`,
            {
                headers: this._getHeaders()
            }
        )
        if (!response.ok)
            throw new Error(
                `Failed to get graph labels: ${response.statusText}`
            )
        return response.json().then((labels: string[]) => labels)
    }

    async getPopularLabels(limit: number = 300): Promise<PopularLabel[]> {
        if (!this._initialized) await this.initialize()
        const response = await chatLunaFetch(
            `${this._baseUrl}/graph/label/popular?limit=${limit}`,
            { headers: this._getHeaders() }
        )
        if (!response.ok)
            throw new Error(
                `Failed to get popular labels: ${response.statusText}`
            )
        return response.json().then((result) => result as PopularLabel[])
    }

    async searchLabels(q: string, limit: number = 50): Promise<string[]> {
        if (!this._initialized) await this.initialize()
        const response = await chatLunaFetch(
            `${this._baseUrl}/graph/label/search?q=${encodeURIComponent(q)}&limit=${limit}`,
            { headers: this._getHeaders() }
        )
        if (!response.ok)
            throw new Error(`Failed to search labels: ${response.statusText}`)
        return response.json().then((result) => result as string[])
    }

    async getKnowledgeGraph(
        label: string,
        maxDepth: number = 3,
        maxNodes: number = 1000
    ): Promise<KnowledgeGraph> {
        if (!this._initialized) await this.initialize()
        const response = await chatLunaFetch(
            `${this._baseUrl}/graphs?label=${encodeURIComponent(label)}&max_depth=${maxDepth}&max_nodes=${maxNodes}`,
            { headers: this._getHeaders() }
        )
        if (!response.ok)
            throw new Error(
                `Failed to get knowledge graph: ${response.statusText}`
            )
        return response.json().then((result) => result as KnowledgeGraph)
    }

    async checkEntityExists(name: string): Promise<boolean> {
        if (!this._initialized) await this.initialize()
        const response = await chatLunaFetch(
            `${this._baseUrl}/graph/entity/exists?name=${encodeURIComponent(name)}`,
            { headers: this._getHeaders() }
        )
        if (!response.ok)
            throw new Error(
                `Failed to check entity existence: ${response.statusText}`
            )
        const result = await response
            .json()
            .then((data) => data as EntityExistsResponse)
        return result.exists
    }

    async updateEntity(entity: EntityUpdateRequest): Promise<GraphEntity> {
        if (!this._initialized) await this.initialize()
        const response = await chatLunaFetch(
            `${this._baseUrl}/graph/entity/edit`,
            {
                method: 'POST',
                headers: this._getHeaders(),
                body: JSON.stringify(entity)
            }
        )
        if (!response.ok)
            throw new Error(`Failed to update entity: ${response.statusText}`)
        return response.json().then((data) => data as GraphEntity)
    }

    async deleteEntity(entityName: string): Promise<DeletionResult> {
        if (!this._initialized) await this.initialize()
        const response = await chatLunaFetch(
            `${this._baseUrl}/documents/delete_entity`,
            {
                method: 'DELETE',
                headers: this._getHeaders(),
                body: JSON.stringify({ entity_name: entityName })
            }
        )
        if (!response.ok)
            throw new Error(`Failed to delete entity: ${response.statusText}`)
        return response.json().then((data) => data as DeletionResult)
    }

    async updateRelation(
        relation: RelationUpdateRequest
    ): Promise<GraphRelation> {
        if (!this._initialized) await this.initialize()
        const response = await chatLunaFetch(
            `${this._baseUrl}/graph/relation/edit`,
            {
                method: 'POST',
                headers: this._getHeaders(),
                body: JSON.stringify(relation)
            }
        )
        if (!response.ok)
            throw new Error(`Failed to update relation: ${response.statusText}`)
        return response.json().then((data) => data as GraphRelation)
    }

    async dispose(): Promise<void> {
        this._initialized = false
    }
}

/**
 * Configuration for LightRAG retriever
 */
export interface LightRAGRetrieverConfig extends RetrieverConfig {
    /** Base URL of the LightRAG server */
    baseUrl?: string
    /** API Key for the LightRAG server */
    apiKey?: string
    defaultQueryMode?: QueryMode
    llm?: ChatLunaChatModel
}

/**
 * Factory function to create a LightRAG retriever instance
 */
export function createLightRAGRetriever(
    ctx: Context,
    config: LightRAGRetrieverConfig
): LightRAGRetriever {
    return new LightRAGRetriever(ctx, config)
}
