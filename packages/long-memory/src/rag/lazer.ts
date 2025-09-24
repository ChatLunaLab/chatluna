import { Context } from 'koishi'
import { Config, logger } from '..'
import {
    EnhancedMemory,
    MemoryRetrievalLayerInfo,
    MemoryRetrievalLayerType
} from '../types'
import {
    BaseMemoryRetrievalLayer,
    createVectorStoreRetriever
} from '../utils/layer'
import { MemoryGraph } from './graph'
import { SpreadingActivationOptions } from './types'
import {
    documentToEnhancedMemory,
    enhancedMemoryToDocument
} from '../utils/memory'
import { promises as fs } from 'fs'
import * as path from 'path'
import { ChatLunaSaveableVectorStore } from 'koishi-plugin-chatluna/llm-core/vectorstores'
import { extractGraphElements } from './extractor'

// Helper function to get the persistence path for a memory graph
function getGraphFilePath(baseDir: string, memoryId: string): string {
    return path.join(
        baseDir,
        'data',
        'chatluna-long-memory',
        'rag',
        `${memoryId}.json`
    )
}

/**
 * A memory retrieval layer based on the EMGAS (Episodic Memory Graph with Activation Spreading) framework.
 */
export class EmgasMemoryLayer<
    T extends MemoryRetrievalLayerType = MemoryRetrievalLayerType
> extends BaseMemoryRetrievalLayer<T> {
    private memoryGraph: MemoryGraph

    constructor(
        protected ctx: Context,
        protected config: Config,
        public info: MemoryRetrievalLayerInfo<T>
    ) {
        super(ctx, config, info)
        this.memoryGraph = new MemoryGraph()
    }

    async initialize(): Promise<void> {
        logger.info(
            `Initializing EMGAS layer for memory ID: ${this.info.memoryId}`
        )
        const baseDir = this.ctx.baseDir || process.cwd()
        const filePath = getGraphFilePath(baseDir, this.info.memoryId)

        try {
            const data = await fs.readFile(filePath, 'utf-8')
            const serialized = JSON.parse(data)
            this.memoryGraph = MemoryGraph.fromJSON(serialized)
            logger.info(`EMGAS graph loaded from ${filePath}`)
        } catch (error) {
            if (error.code === 'ENOENT') {
                logger.info(
                    `No existing EMGAS graph found for ${this.info.memoryId}. A new one will be created.`
                )
            } else {
                logger.error(
                    `Failed to load EMGAS graph from ${filePath}:`,
                    error
                )
            }
        }

        // Initialize the vector store for passage storage
        this.retriever = await createVectorStoreRetriever(
            this.ctx,
            this.config,
            this.info.memoryId
        )
        this.vectorStore = this.retriever.vectorStore

        // Activate the forgetting mechanism
        this.ctx.setInterval(
            async () => {
                logger.info(
                    `Running memory lifecycle tasks for graph: ${this.info.memoryId}`
                )
                // Decay: Simulate passive forgetting over time
                const decayRate = 0.01 // Configurable: higher means faster forgetting
                this.memoryGraph.applyDecay(decayRate)

                // Prune: Actively remove nodes that are no longer relevant
                const pruneThreshold = 0.05 // Configurable: nodes below this activation are removed
                this.memoryGraph.pruneGraph(pruneThreshold)

                // Persist the changes
                await this.saveGraph()
            },
            1000 * 60 * 10
        ) // Run every 10 minutes
    }

    private async saveGraph(): Promise<void> {
        const baseDir = this.ctx.baseDir || process.cwd()
        const filePath = getGraphFilePath(baseDir, this.info.memoryId)

        try {
            await fs.mkdir(path.dirname(filePath), { recursive: true })
            const serialized = this.memoryGraph.toJSON()
            await fs.writeFile(filePath, JSON.stringify(serialized, null, 2))
        } catch (error) {
            logger.error(`Failed to save EMGAS graph to ${filePath}:`, error)
        }
    }

    async addMemories(memories: EnhancedMemory[]): Promise<void> {
        if (memories.length === 0) return

        // Add documents to the vector store first
        const docs = memories.map(enhancedMemoryToDocument)
        await this.vectorStore.addDocuments(docs)

        // Then, extract graph elements and update the memory graph
        for (const memory of memories) {
            const elements = await extractGraphElements(
                this.ctx,
                this.config,
                memory.content
            )
            if (elements && elements.concepts.length > 0) {
                this.memoryGraph.incrementalUpdate(elements, memory.rawId)
            }
        }

        await this.saveGraph()
        if (this.vectorStore instanceof ChatLunaSaveableVectorStore) {
            await this.vectorStore.save()
        }
    }

    async retrieveMemory(searchContent: string): Promise<EnhancedMemory[]> {
        if (!this.vectorStore) {
            logger.warn('EMGAS layer not initialized, cannot retrieve memory.')
            return []
        }

        // Use the LLM to extract key concepts from the user's query to use as seeds
        const queryElements = await extractGraphElements(
            this.ctx,
            this.config,
            searchContent
        )

        if (!queryElements || queryElements.concepts.length === 0) {
            logger.info(
                'No seed concepts extracted from query. Skipping graph retrieval.'
            )
            return []
        }

        logger.info(
            `Extracted seed concepts: ${queryElements.concepts.join(', ')}`
        )

        const options: SpreadingActivationOptions = {
            firingThreshold: 0.1,
            propagationDecay: 0.85, // Allows activation to spread reasonably far
            maxIterations: 5, // A good balance between depth and performance
            topN: 20 // Retrieve a good number of candidates from the graph
        }

        const passageIds = this.memoryGraph.retrieveContext(
            queryElements.concepts,
            options
        )

        if (passageIds.size === 0) {
            return []
        }

        // Fetch the actual documents from the vector store using their IDs.
        const allDocs = await this.vectorStore.similaritySearch(
            ' ',
            passageIds.size * 2
        )
        const relevantDocs = allDocs.filter(
            (doc) => doc.metadata.raw_id && passageIds.has(doc.metadata.raw_id)
        )

        logger.info(
            `Retrieved ${relevantDocs.length} full documents from vector store.`
        )

        return relevantDocs.map(documentToEnhancedMemory)
    }

    async deleteMemories(memoryIds: string[]): Promise<void> {
        if (typeof this.vectorStore.delete !== 'function') {
            logger.warn('Vector store does not support deletion.')
            return
        }

        await this.vectorStore.delete({ ids: memoryIds })

        // In the graph, remove the passage ID from all nodes that reference it.
        for (const node of this.memoryGraph.getNodes()) {
            if (node.sourcePassageIds) {
                for (const id of memoryIds) {
                    node.sourcePassageIds.delete(id)
                }
            }
        }

        await this.saveGraph()
        if (this.vectorStore instanceof ChatLunaSaveableVectorStore) {
            await this.vectorStore.save()
        }
    }

    async clearMemories(): Promise<void> {
        this.memoryGraph = new MemoryGraph()
        await this.saveGraph()

        if (this.vectorStore && typeof this.vectorStore.delete === 'function') {
            await this.vectorStore.delete({ deleteAll: true })
        }
        logger.info(
            `Cleared EMGAS graph and associated vector store for memory ID: ${this.info.memoryId}`
        )
    }
}
