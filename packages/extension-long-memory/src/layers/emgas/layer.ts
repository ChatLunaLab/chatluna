import { Context } from 'koishi'
import { randomUUID } from 'crypto'
import { Config, logger } from '../../index'
import {
    EnhancedMemory,
    MemoryRetrievalLayerInfo,
    MemoryRetrievalLayerType
} from '../../types'
import {
    BaseMemoryRetrievalLayer,
    resolveLongMemoryId
} from '../../utils/layer'
import { MemoryGraph } from './graph'
import { SpreadingActivationOptions } from './types'
import {
    documentToEnhancedMemory,
    enhancedMemoryToDocument
} from '../../utils/memory'
import { promises as fs } from 'fs'
import * as path from 'path'
import { DataBaseDocstore } from 'koishi-plugin-chatluna/llm-core/vectorstores'
import { extractGraphElements } from './extractor'
import { ComputedRef } from 'koishi-plugin-chatluna'
import { ChatLunaChatModel } from 'koishi-plugin-chatluna/llm-core/platform/model'

// Helper function to get the persistence path for a memory graph
function getGraphFilePath(baseDir: string, memoryId: string): string {
    if (!memoryId || typeof memoryId !== 'string') {
        throw new Error('Invalid memoryId: must be a non-empty string.')
    }

    const sanitizedId = path.basename(memoryId)

    if (sanitizedId !== memoryId) {
        throw new Error(`Invalid memoryId: contains path separators.`)
    }

    return path.join(
        baseDir,
        'data/chatluna/long-memory/emgasa',
        `${sanitizedId}.json`
    )
}

/**
 * A memory retrieval layer based on the EMGAS (Episodic Memory Graph with Activation Spreading) framework.
 */
export class EmgasMemoryLayer<
    T extends MemoryRetrievalLayerType = MemoryRetrievalLayerType
> extends BaseMemoryRetrievalLayer<T> {
    private memoryGraph: MemoryGraph

    private docstore: DataBaseDocstore

    private extractModel: ComputedRef<ChatLunaChatModel>

    constructor(
        protected ctx: Context,
        protected config: Config,
        public info: Required<MemoryRetrievalLayerInfo<T>>
    ) {
        super(ctx, config, info)
        this.memoryGraph = new MemoryGraph()
    }

    async initialize(): Promise<void> {
        logger.debug(
            `Initializing EMGAS layer for memory ID: ${this.info.memoryId}`
        )
        const baseDir = this.ctx.baseDir || process.cwd()
        const filePath = getGraphFilePath(baseDir, this.info.memoryId)

        try {
            const data = await fs.readFile(filePath, 'utf-8')
            const serialized = JSON.parse(data)
            this.memoryGraph = MemoryGraph.fromJSON(serialized)
            logger.debug(`EMGAS graph loaded from ${filePath}`)
        } catch (error) {
            const err = error as NodeJS.ErrnoException
            if (err && err.code === 'ENOENT') {
                logger.debug(
                    `No existing EMGAS graph found for ${this.info.memoryId}. A new one will be created.`
                )
            } else {
                logger.error(
                    `Failed to load EMGAS graph from ${filePath}:`,
                    error
                )
            }
        }

        this.extractModel = await this.ctx.chatluna.createChatModel(
            this.config.emgasExtractModel
        )

        // Initialize the doc store for passage storage
        this.docstore = new DataBaseDocstore(
            this.ctx,
            resolveLongMemoryId(this.info)
        )

        // Activate the forgetting mechanism
        this.ctx.setInterval(
            async () => {
                logger.debug(
                    `Running memory lifecycle tasks for graph: ${this.info.memoryId}`
                )
                // Decay: Simulate passive forgetting over time
                const decayRate = this.config.emgasDecayRate ?? 0.01 // Configurable: higher means faster forgetting
                this.memoryGraph.applyDecay(decayRate)

                // Prune: Actively remove nodes that are no longer relevant
                const pruneThreshold = this.config.emgasPruneThreshold ?? 0.05 // Configurable: nodes below this activation are removed
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

        // Ensure each memory has a stable ID to prevent overwrites
        for (const memory of memories) {
            if (!memory.id) {
                memory.id = randomUUID()
            }
        }

        // Add documents to the doc store first
        const docs = memories.map(enhancedMemoryToDocument)
        await this.docstore.add(
            Object.fromEntries(docs.map((doc) => [doc.id, doc]))
        )

        // Then, extract graph elements and update the memory graph
        for (const memory of memories) {
            const elements = await extractGraphElements(
                this.extractModel,
                memory.content
            )
            if (elements && elements.concepts.length > 0) {
                this.memoryGraph.incrementalUpdate(elements, memory.id)
            }
        }

        await this.saveGraph()
    }

    async retrieveMemory(searchContent: string): Promise<EnhancedMemory[]> {
        // Use the LLM to extract key concepts from the user's query to use as seeds
        const queryElements = await extractGraphElements(
            this.extractModel,
            searchContent
        )

        if (!queryElements || queryElements.concepts.length === 0) {
            logger.debug(
                'No seed concepts extracted from query. Skipping graph retrieval.'
            )
            return []
        }

        logger.debug(
            `Extracted seed concepts: ${queryElements.concepts.join(', ')}`
        )

        const options: SpreadingActivationOptions = {
            firingThreshold: this.config.emgasFiringThreshold ?? 0.1,
            propagationDecay: this.config.emgasPropagationDecay ?? 0.85, // Allows activation to spread reasonably far
            maxIterations: this.config.emgasMaxIterations ?? 5, // A good balance between depth and performance
            topN: this.config.emgasTopN ?? 20 // Retrieve a good number of candidates from the graph
        }

        const passageIds = this.memoryGraph.retrieveContext(
            queryElements.concepts,
            options
        )

        if (passageIds.size === 0) {
            return []
        }

        // Fetch the actual documents from the doc store using their IDs.
        const relevantDocs = await this.docstore.list({
            ids: Array.from(passageIds),
            limit: passageIds.size
        })

        return relevantDocs.map((doc) =>
            documentToEnhancedMemory(doc, this.info)
        )
    }

    async deleteMemories(memoryIds: string[]): Promise<void> {
        await this.docstore.delete({ ids: memoryIds })

        // In the graph, remove the passage ID from all nodes that reference it.
        for (const node of this.memoryGraph.getNodes()) {
            if (node.sourcePassageIds) {
                for (const id of memoryIds) {
                    node.sourcePassageIds.delete(id)
                }
            }
        }

        await this.saveGraph()
    }

    async clearMemories(): Promise<void> {
        this.memoryGraph = new MemoryGraph()
        await this.saveGraph()

        await this.docstore.delete({ deleteAll: true })
        logger.debug(
            `Cleared EMGAS graph and associated doc store for memory ID: ${this.info.memoryId}`
        )
    }
}
