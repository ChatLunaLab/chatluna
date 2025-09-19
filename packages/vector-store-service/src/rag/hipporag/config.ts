import { Embeddings } from '@langchain/core/embeddings'
import { ChatLunaChatModel } from 'koishi-plugin-chatluna/llm-core/platform/model'

/**
 * Base configuration interface for HippoRAG
 */
export interface HippoRAGConfig {
    // Model configurations
    llm: ChatLunaChatModel
    embeddings: Embeddings

    key?: string

    saveDir?: string

    // Graph configurations
    isDirectedGraph?: boolean

    // Retrieval configurations
    retrievalTopK?: number
    linkingTopK?: number
    passageNodeWeight?: number
    damping?: number

    // Synonymy edge configurations
    synonymyEdgeTopK?: number
    synonymyEdgeSimThreshold?: number
    synonymyEdgeQueryBatchSize?: number
    synonymyEdgeKeyBatchSize?: number
}

export function defineHippoRAGConfig(
    options: Partial<HippoRAGConfig> = {}
): HippoRAGConfig {
    return {
        llm: options.llm,
        embeddings: options.embeddings,
        saveDir: options.saveDir,
        key: options.key ?? 'hippo-rag',
        isDirectedGraph: options.isDirectedGraph || false,
        retrievalTopK: options.retrievalTopK || 20,
        linkingTopK: options.linkingTopK || 10,
        passageNodeWeight: options.passageNodeWeight || 0.05,
        damping: options.damping || 0.5,
        synonymyEdgeTopK: options.synonymyEdgeTopK || 10,
        synonymyEdgeSimThreshold: options.synonymyEdgeSimThreshold || 0.8,
        synonymyEdgeQueryBatchSize: options.synonymyEdgeQueryBatchSize || 100,
        synonymyEdgeKeyBatchSize: options.synonymyEdgeKeyBatchSize || 1000
    }
}
