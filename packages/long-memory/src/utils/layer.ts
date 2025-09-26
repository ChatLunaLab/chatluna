import { Config } from '..'
import { VectorStoreRetriever } from '@langchain/core/vectorstores'
import { ChatLunaSaveableVectorStore } from 'koishi-plugin-chatluna/llm-core/vectorstores'
import { Context } from 'koishi'
import {
    EnhancedMemory,
    MemoryRetrievalLayerInfo,
    MemoryRetrievalLayerType
} from '../types'

import { Document } from '@langchain/core/documents'
import { createHash } from 'crypto'

// Interface for memory retrieval layer
interface MemoryRetrievalLayer {
    // Retrieve memory based on the search content
    retrieveMemory(searchContent: string): Promise<EnhancedMemory[]>
    // Add new memories
    addMemories(memories: EnhancedMemory[]): Promise<void>
    // Initialize the layer
    initialize(): Promise<void>
}

// Base class for memory retrieval layer
export abstract class BaseMemoryRetrievalLayer<
    T extends MemoryRetrievalLayerType = MemoryRetrievalLayerType
> implements MemoryRetrievalLayer
{
    protected vectorStore?: ChatLunaSaveableVectorStore
    protected retriever?: VectorStoreRetriever<ChatLunaSaveableVectorStore>

    constructor(
        protected ctx: Context,
        protected config: Config,
        public info: MemoryRetrievalLayerInfo<T>
    ) {}

    abstract retrieveMemory(searchContent: string): Promise<EnhancedMemory[]>
    abstract addMemories(memories: EnhancedMemory[]): Promise<void>
    abstract deleteMemories(memoryIds: string[]): Promise<void>
    abstract initialize(): Promise<void>
    abstract clearMemories(): Promise<void>

    async cleanupExpiredMemories(): Promise<void> {}
}

export function sortMemoryRetrievalLayerType(
    a: MemoryRetrievalLayerType,
    b: MemoryRetrievalLayerType
): number {
    return a.localeCompare(b)
}

export const resolveLongMemoryId = (
    presetId: string,
    userId: string,
    layerType: MemoryRetrievalLayerType
) => {
    let hash = createHash('sha256')

    switch (layerType) {
        case 'user':
            hash = hash.update(`${userId}`)
            break
        case 'preset':
            hash = hash.update(`${presetId}`)
            break
        case 'global':
        default:
            hash = hash.update('global')
            break
    }

    const hex = hash.digest('hex')

    return hex
}

export function isObject(x: unknown): x is Record<string, unknown> {
    return !!x && typeof x === 'object'
}

export function isKGStatsLayer(
    x: unknown
): x is { getKGStats(): { entities: number; edges: number } } {
    return (
        isObject(x) &&
        'getKGStats' in x &&
        typeof (x as { getKGStats?: unknown }).getKGStats === 'function'
    )
}

export function isKGNeighborsLayer(x: unknown): x is {
    getNeighbors(e: string, k?: number): { entity: string; weight: number }[]
} {
    return (
        isObject(x) &&
        'getNeighbors' in x &&
        typeof (x as { getNeighbors?: unknown }).getNeighbors === 'function'
    )
}

export function isKGRebuildLayer(
    x: unknown
): x is { rebuildKGIndex(): Promise<void> } {
    return (
        isObject(x) &&
        'rebuildKGIndex' in x &&
        typeof (x as { rebuildKGIndex?: unknown }).rebuildKGIndex === 'function'
    )
}

export function isExplainLayer(x: unknown): x is {
    explainRetrieve(
        q: string,
        o?: { topEntities?: number; topDocs?: number }
    ): Promise<unknown>
} {
    return (
        isObject(x) &&
        'explainRetrieve' in x &&
        typeof (x as { explainRetrieve?: unknown }).explainRetrieve ===
            'function'
    )
}

export function hasEditDocument(
    vs: unknown
): vs is { editDocument(doc: Document): Promise<void> } {
    return (
        typeof vs === 'object' &&
        vs !== null &&
        'editDocument' in vs &&
        typeof (vs as { editDocument?: unknown }).editDocument === 'function'
    )
}
