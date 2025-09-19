import { Document } from '@langchain/core/documents'

export interface ChunkInfo {
    numTokens?: number
    content: string
    chunkOrder?: [number, number][]
    fullDocIds?: string[]
}

export interface NerRawOutput {
    chunkId: string
    response: string | null
    uniqueEntities: string[]
    metadata?: Document['metadata']
}

export interface TripleRawOutput {
    chunkId: string
    response: string | null
    metadata?: Document['metadata']
    triples: Triple[]
}

export interface OpenIEResult {
    ner: NerRawOutput
    triplets: TripleRawOutput
}

/**
 * Serialized OpenIE document structure
 */
export interface OpenIEDocument {
    idx: string
    passage: string
    extractedEntities: string[]
    extractedTriples: Triple[]
}

/**
 * Complete OpenIE results structure for serialization
 */
export interface OpenIEResults {
    docs: OpenIEDocument[]
}

/**
 * Query solution structure for retrieval results
 */
export interface QuerySolution {
    question: string
    docs: Document[]
    docScores?: number[]
}

export type Triple = [string, string, string]
