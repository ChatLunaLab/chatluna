import { Context } from 'koishi'
import { Config, logger } from '../../index'
import {
    EnhancedMemory,
    MemoryRetrievalLayerInfo,
    MemoryRetrievalLayerType
} from '../../types'
import { BaseMemoryRetrievalLayer } from '../../utils/layer'
import {
    documentToEnhancedMemory,
    enhancedMemoryToDocument,
    isMemoryExpired
} from '../../utils/memory'
import { DataBaseDocstore } from 'koishi-plugin-chatluna/llm-core/vectorstores'

/**
 * A basic memory retrieval layer that stores and retrieves all memories directly from the database.
 * This layer returns all memories without any filtering or ranking.
 */
export class BasicMemoryLayer<
    T extends MemoryRetrievalLayerType = MemoryRetrievalLayerType
> extends BaseMemoryRetrievalLayer<T> {
    private docstore: DataBaseDocstore

    constructor(
        protected ctx: Context,
        protected config: Config,
        public info: Required<MemoryRetrievalLayerInfo<T>>
    ) {
        super(ctx, config, info)

        // Set up periodic cleanup of expired memories
        ctx.setInterval(
            async () => {
                await this.cleanupExpiredMemories()
            },
            1000 * 60 * 10
        ) // Run every 10 minutes
    }

    async initialize(): Promise<void> {
        if (!this.info.memoryId) {
            throw new Error(
                'Cannot initialize BasicMemoryLayer: memoryId is missing.'
            )
        }

        // Initialize the doc store for memory storage
        this.docstore = new DataBaseDocstore(this.ctx, this.info.memoryId)

        logger.debug(
            `Basic layer initialized for memory ID: ${this.info.memoryId}`
        )
    }

    async retrieveMemory(searchContent: string): Promise<EnhancedMemory[]> {
        // Basic layer returns ALL memories without any filtering
        // The search content is ignored as this is a basic implementation

        try {
            const allDocs = await this.docstore.list({
                limit: 1000 // Get a large number of memories
            })

            // Convert documents to enhanced memories and filter out expired ones
            const memories = allDocs
                .map((doc) => documentToEnhancedMemory(doc, this.info))
                .filter((memory) => !isMemoryExpired(memory))

            return memories
        } catch (error) {
            logger.error('Error retrieving memories from basic layer:', error)
            return []
        }
    }

    async addMemories(memories: EnhancedMemory[]): Promise<void> {
        if (memories.length === 0) return

        try {
            // Convert memories to documents and add to docstore
            const docs = memories.map(enhancedMemoryToDocument)
            await this.docstore.add(
                Object.fromEntries(docs.map((doc) => [doc.id, doc]))
            )

            logger.debug(
                `Basic layer added ${memories.length} memories to doc store.`
            )
        } catch (error) {
            logger.error('Error adding memories to basic layer:', error)
            throw error
        }
    }

    async deleteMemories(memoryIds: string[]): Promise<void> {
        if (memoryIds.length === 0) return

        try {
            await this.docstore.delete({ ids: memoryIds })

            logger.debug(
                `Basic layer deleted ${memoryIds.length} memories from doc store.`
            )
        } catch (error) {
            logger.error('Error deleting memories from basic layer:', error)
            throw error
        }
    }

    async clearMemories(): Promise<void> {
        try {
            await this.docstore.delete({ deleteAll: true })

            logger.debug(
                `Basic layer cleared all memories for memory ID: ${this.info.memoryId}`
            )
        } catch (error) {
            logger.error('Error clearing memories from basic layer:', error)
            throw error
        }
    }

    async cleanupExpiredMemories(): Promise<void> {
        try {
            // Get all memories to check for expiration
            const allDocs = await this.docstore.list({
                limit: 1000
            })

            // Find expired memory IDs
            const expiredMemoryIds: string[] = []

            for (const doc of allDocs) {
                const memory = documentToEnhancedMemory(doc, this.info)
                if (isMemoryExpired(memory) && doc.id) {
                    expiredMemoryIds.push(doc.id)
                }
            }

            if (expiredMemoryIds.length > 0) {
                logger.debug(
                    `Basic layer found ${expiredMemoryIds.length} expired memories to delete`
                )

                await this.deleteMemories(expiredMemoryIds)

                logger.debug(
                    `Basic layer cleaned up ${expiredMemoryIds.length} expired memories`
                )
            }
        } catch (error) {
            logger.error('Error during Basic layer memory cleanup:', error)
        }
    }
}
