import { Config } from '..'
import { VectorStoreRetriever } from '@langchain/core/vectorstores'
import { ChatLunaSaveableVectorStore } from 'koishi-plugin-chatluna/llm-core/vectorstores'
import { Context } from 'koishi'
import {
    EnhancedMemory,
    MemoryRetrievalLayerInfo,
    MemoryRetrievalLayerType
} from '../types'
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
        public info: Required<MemoryRetrievalLayerInfo<T>>
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

export const resolveLongMemoryId = <T extends MemoryRetrievalLayerType>(
    info: MemoryRetrievalLayerInfo<T>,
    layerType: T = info.type
) => {
    let hash = createHash('sha256')

    switch (layerType) {
        case 'user':
            hash = hash.update(`user-${info.userId}`)
            break
        case 'preset':
            hash = hash.update(`preset-${info.presetId}`)
            break
        case 'guild':
            hash = hash.update(`guild-${info.guildId}`)
            break
        case 'global':
        default:
            hash = hash.update('global')
            break
    }

    const hex = hash.digest('hex')

    return hex
}
