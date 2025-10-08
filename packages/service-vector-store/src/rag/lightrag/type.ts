/* eslint-disable @typescript-eslint/no-explicit-any */

// This file is auto-generated from the lightrag-openapi.json file.

export type DocStatus = 'pending' | 'processing' | 'processed' | 'failed'

export interface TextDocument {
    text: string
    metadata?: Record<string, any>
}

export interface InsertTextsRequest {
    texts: string[]
    file_sources?: string[]
}

export interface InsertResponse {
    status: 'success' | 'duplicated' | 'partial_success' | 'failure'
    message: string
    track_id: string
}

export type QueryMode =
    | 'local'
    | 'global'
    | 'hybrid'
    | 'naive'
    | 'mix'
    | 'bypass'

export interface QueryRequest {
    query: string
    mode?: QueryMode
    only_need_context?: boolean | null
    only_need_prompt?: boolean | null
    response_type?: string | null
    top_k?: number | null
    chunk_top_k?: number | null
    max_entity_tokens?: number | null
    max_relation_tokens?: number | null
    max_total_tokens?: number | null
    conversation_history?: Record<string, any>[] | null
    user_prompt?: string | null
    enable_rerank?: boolean | null
    include_references?: boolean | null
    stream?: boolean | null
}

export interface Entity {
    entity_name: string
    entity_type: string
    description: string
    source_id: string
    file_path: string
    reference_id: string
}

export interface Relationship {
    src_id: string
    tgt_id: string
    description: string
    keywords: string
    weight: number
    source_id: string
    file_path: string
    reference_id: string
}

export interface Chunk {
    content: string
    file_path: string
    chunk_id: string
    reference_id: string
}

export interface Reference {
    reference_id: string
    file_path: string
}

export interface QueryData {
    entities?: Entity[]
    relationships?: Relationship[]
    chunks?: Chunk[]
    references?: Reference[]
}

export interface QueryMetadata {
    query_mode: string
    keywords: {
        high_level: string[]
        low_level: string[]
    }
    processing_info: {
        total_entities_found: number
        total_relations_found: number
        entities_after_truncation: number
        relations_after_truncation: number
        final_chunks_count: number
    }
}

export interface QueryDataResponse {
    status: 'success' | 'failure'
    message: string
    data: QueryData
    metadata: QueryMetadata
}

export interface DocStatusResponse {
    id: string
    content_summary: string
    content_length: number
    status: DocStatus
    created_at: string
    updated_at: string
    track_id?: string | null
    chunks_count?: number | null
    error_msg?: string | null
    metadata?: Record<string, any> | null
    file_path: string
}

export interface PaginationInfo {
    page: number
    page_size: number
    total_count: number
    total_pages: number
    has_next: boolean
    has_prev: boolean
}

export interface PaginatedDocsResponse {
    documents: DocStatusResponse[]
    pagination: PaginationInfo
    status_counts: Record<string, number>
}

export interface DocumentsRequest {
    status_filter?: DocStatus | null
    page?: number
    page_size?: number
    sort_field?: 'created_at' | 'updated_at' | 'id' | 'file_path'
    sort_direction?: 'asc' | 'desc'
}

export interface DeleteDocRequest {
    doc_ids: string[]
    delete_file?: boolean
}

export interface StatusCountsResponse {
    status_counts: Record<string, number>
}

// Graph related types
export interface EntityUpdateRequest {
    entity_name: string
    updated_data: Record<string, any>
    allow_rename?: boolean
}

export interface RelationUpdateRequest {
    source_id: string
    target_id: string
    updated_data: Record<string, any>
}

export interface GraphEntity {
    id: string
    label: string
    properties: Record<string, any>
}

export interface GraphRelation {
    source: string // source node id
    target: string // target node id
    type: string
    properties: Record<string, any>
}

export interface KnowledgeGraph {
    nodes: GraphEntity[]
    edges: GraphRelation[]
}

export interface PopularLabel {
    label: string
    degree: number
}

export interface DeletionResult {
    status: 'success' | 'not_found' | 'fail'
    doc_id: string
    message: string
    status_code?: number
    file_path?: string | null
}

export interface EntityExistsResponse {
    exists: boolean
}
