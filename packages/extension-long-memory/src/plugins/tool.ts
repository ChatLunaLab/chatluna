/* eslint-disable max-len */
import { StructuredTool } from '@langchain/core/tools'
import { Context } from 'koishi'
import { ChatLunaPlugin } from 'koishi-plugin-chatluna/services/chat'
import { Config, logger } from '../index'
import {
    ChatLunaToolRunnable,
    CreateToolParams
} from 'koishi-plugin-chatluna/llm-core/platform/types'
import { z } from 'zod'
import { EnhancedMemory, MemoryRetrievalLayerType, MemoryType } from '../types'
import { calculateExpirationDate } from '../utils/memory'
import { randomUUID } from 'crypto'

/**
 * Build memory retrieval layer info from tool config
 */
function buildMemoryInfo(config: ChatLunaToolRunnable) {
    return {
        presetId: config.configurable.preset,
        guildId:
            config.configurable.session.guildId ||
            config.configurable.session.channelId,
        userId: config.configurable.userId
    }
}

export async function apply(
    ctx: Context,
    config: Config,
    plugin: ChatLunaPlugin
) {
    plugin.registerTool('memory_search', {
        selector(history) {
            return true
        },

        createTool(params) {
            return new MemorySearchTool(ctx, params)
        }
    })

    plugin.registerTool('memory_add', {
        selector(history) {
            return true
        },

        createTool(params) {
            return new MemoryAddTool(ctx, params)
        }
    })

    plugin.registerTool('memory_delete', {
        selector(history) {
            return true
        },

        createTool(params) {
            return new MemoryDeleteTool(ctx, params)
        }
    })

    plugin.registerTool('memory_update', {
        selector(history) {
            return true
        },

        createTool(params) {
            return new MemoryUpdateTool(ctx, params)
        }
    })
}

export class MemorySearchTool extends StructuredTool {
    name = 'memory_search'

    schema = z.object({
        content: z.string().describe('The search content of the memory'),
        layer: z
            .array(
                z.union([
                    z.literal('user'),
                    z.literal('preset'),
                    z.literal('guild'),
                    z.literal('global')
                ])
            )
            .describe('The layer of the memory')
    })

    constructor(
        private ctx: Context,
        private params: CreateToolParams
    ) {
        super({})
    }

    /** @ignore */
    async _call(
        input: z.infer<typeof this.schema>,
        _,
        config: ChatLunaToolRunnable
    ) {
        try {
            const parsedLayerType =
                input.layer != null
                    ? input.layer.map(
                          (layer) =>
                              MemoryRetrievalLayerType[layer.toUpperCase()]
                      )
                    : MemoryRetrievalLayerType.USER

            const info = buildMemoryInfo(config)

            await this.ctx.chatluna_long_memory.initMemoryLayers(
                info,
                config.configurable.conversationId,
                parsedLayerType
            )

            const result = await this.ctx.chatluna_long_memory.retrieveMemory(
                info,
                input.content,
                parsedLayerType
            )

            return JSON.stringify(result)
        } catch (error) {
            this.ctx.logger.error(error)
            return 'An error occurred while searching for memories.'
        }
    }

    // eslint-disable-next-line max-len
    description = `Searches user-related memories based on keywords or phrases. Usage guidelines:

    - content: Specify search keywords or phrases (e.g., "birthday", "favorite food") to retrieve relevant memories
    - layer: Specify which memory layers to search in as an array. Available layers:
      * user:  User-specific memories shared across all presets
      * preset: Memories shared by all users using the same preset
      * guild: (Recommended in group chats) Guild-specific memories shared across all users in the same guild/group
      * global: Memories shared across all users and presets

    Usage timing: Prioritize 'guild' layer when in group chats to access guild-specific memories. Use 'user' layer for individual user memories.`
}

export class MemoryAddTool extends StructuredTool {
    name = 'memory_add'

    schema = z.object({
        memories: z
            .array(
                z.object({
                    content: z.string().describe('The content of the memory'),
                    type: z
                        .nativeEnum(MemoryType)
                        .describe('The type of the memory'),
                    importance: z
                        .number()
                        .min(1)
                        .max(10)
                        .describe('The importance of the memory (1-10)')
                })
            )
            .describe('Array of memories to add'),
        layer: z
            .array(
                z.union([
                    z.literal('user'),
                    z.literal('preset'),
                    z.literal('guild'),
                    z.literal('global')
                ])
            )
            .describe('The layer of the memory')
    })

    constructor(
        private ctx: Context,
        private params: CreateToolParams
    ) {
        super({})
    }

    /** @ignore */
    async _call(
        input: z.infer<typeof this.schema>,
        _,
        config: ChatLunaToolRunnable
    ) {
        try {
            // Convert input memories to EnhancedMemory objects
            const enhancedMemories = input.memories.map((memory) => {
                return {
                    content: memory.content,
                    type: memory.type,
                    id: randomUUID(),
                    importance: memory.importance,
                    expirationDate: calculateExpirationDate(
                        memory.type,
                        memory.importance
                    )
                } as EnhancedMemory
            })

            const parsedLayerType =
                input.layer != null
                    ? input.layer.map(
                          (layer) =>
                              MemoryRetrievalLayerType[layer.toUpperCase()]
                      )
                    : MemoryRetrievalLayerType.USER

            const info = buildMemoryInfo(config)

            await this.ctx.chatluna_long_memory.initMemoryLayers(
                info,
                config.configurable.conversationId,
                parsedLayerType
            )

            // Add memories to the specified layers
            await this.ctx.chatluna_long_memory.addMemories(
                info,
                enhancedMemories,
                parsedLayerType
            )

            return `Successfully added ${enhancedMemories.length} memories.`
        } catch (error) {
            logger.error(error)
            return 'An error occurred while adding memories.'
        }
    }

    description = `Adds user-related memories to specified layers. Each memory requires:

    - memories: Array of memory objects with:
      * content: Memory text (e.g., "Likes pizza")
      * type: Memory category - Options include:
        Long-term: factual, preference, personal, skill, interest, relationship
        Medium-term: contextual, task, location
        Short-term: temporal, event
      * importance: Rating 1-10 (higher = longer retention)

    - layer: Target memory layers (array):
      * user: User memories across all presets
      * preset: Shared memories for all users of this preset
      * guild: Guild-specific memories shared across all users in the same guild/group
      * global: Shared across all users and presets

    Usage timing: Prioritize 'guild' layer when adding group chat-related memories (e.g., guild events, shared experiences). Use 'user' layer for individual user memories.

    System auto-calculates expiration dates based on type and importance.`
}

export class MemoryDeleteTool extends StructuredTool {
    name = 'memory_delete'

    schema = z.object({
        memoryIds: z
            .array(z.string())
            .describe('Array of memory IDs to delete'),
        layer: z
            .array(
                z.union([
                    z.literal('user'),
                    z.literal('preset'),
                    z.literal('guild'),
                    z.literal('global')
                ])
            )
            .describe('The layer of the memory')
    })

    constructor(
        private ctx: Context,
        private params: CreateToolParams
    ) {
        super({})
    }

    /** @ignore */
    async _call(
        input: z.infer<typeof this.schema>,
        _,
        config: ChatLunaToolRunnable
    ) {
        try {
            const parsedLayerType =
                input.layer != null
                    ? input.layer.map(
                          (layer) =>
                              MemoryRetrievalLayerType[layer.toUpperCase()]
                      )
                    : MemoryRetrievalLayerType.USER

            const info = buildMemoryInfo(config)

            await this.ctx.chatluna_long_memory.initMemoryLayers(
                info,
                config.configurable.conversationId,
                parsedLayerType
            )

            await this.ctx.chatluna_long_memory.deleteMemories(
                info,
                input.memoryIds,
                parsedLayerType
            )

            return `Successfully deleted ${input.memoryIds.length} memories.`
        } catch (error) {
            logger.error(error)
            return 'An error occurred while deleting memories.'
        }
    }

    // eslint-disable-next-line max-len
    description = `Deletes user-related memories by their IDs. Usage guidelines:

    - memoryIds: Array of memory IDs to delete
    - layer: Specify which memory layers to delete from as an array. Available layers:
      * user: User-specific memories shared across all presets
      * preset: Memories shared by all users using the same preset
      * guild: Guild-specific memories shared across all users in the same guild/group
      * global: Memories shared across all users and presets

    Usage timing: Use 'guild' layer when deleting group chat-related memories. Use 'user' layer for individual user memories.

    Please search for memory IDs using the 'memory_search' tool before deleting.

    Returns the number of successfully deleted memories.`
}

export class MemoryUpdateTool extends StructuredTool {
    name = 'memory_update'

    schema = z.object({
        memoryIds: z
            .array(z.string())
            .describe('Array of memory IDs to update'),
        newMemories: z
            .array(
                z.object({
                    content: z
                        .string()
                        .describe('The new content of the memory'),
                    type: z
                        .nativeEnum(MemoryType)
                        .describe('The new type of the memory'),
                    importance: z
                        .number()
                        .min(1)
                        .max(10)
                        .describe('The new importance of the memory (1-10)')
                })
            )
            .describe('Array of new memory data to replace the old ones'),
        layer: z
            .array(
                z.union([
                    z.literal('user'),
                    z.literal('preset'),
                    z.literal('guild'),
                    z.literal('global')
                ])
            )
            .describe('The layer of the memory')
    })

    constructor(
        private ctx: Context,
        private params: CreateToolParams
    ) {
        super({})
    }

    /** @ignore */
    async _call(
        input: z.infer<typeof this.schema>,
        _,
        config: ChatLunaToolRunnable
    ) {
        try {
            const layers =
                input.layer != null
                    ? input.layer.map(
                          (layer) =>
                              MemoryRetrievalLayerType[layer.toUpperCase()]
                      )
                    : MemoryRetrievalLayerType.USER

            const info = buildMemoryInfo(config)

            await this.ctx.chatluna_long_memory.initMemoryLayers(
                info,
                config.configurable.conversationId,
                layers
            )

            const enhancedMemories = input.newMemories.map((memory) => {
                return {
                    content: memory.content,
                    type: memory.type,
                    id: randomUUID(), // This will be overridden by updateMemories to preserve original IDs
                    importance: memory.importance,
                    expirationDate: calculateExpirationDate(
                        memory.type,
                        memory.importance
                    )
                } as EnhancedMemory
            })

            // Use the atomic updateMemories API which handles ID preservation and rollback
            await this.ctx.chatluna_long_memory.updateMemories(
                info,
                input.memoryIds,
                enhancedMemories,
                layers
            )

            return `Successfully updated ${input.memoryIds.length} memories.`
        } catch (error) {
            logger.error(error)
            if (error.message.includes('must match')) {
                return `Error: ${error.message}`
            }
            return 'An error occurred while updating memories.'
        }
    }

    // eslint-disable-next-line max-len
    description = `Updates user-related memories by first deleting the old ones and then adding new ones. Usage guidelines:

    - memoryIds: Array of memory IDs to be replaced
    - newMemories: Array of new memory objects with:
      * content: New memory text (e.g., "Prefers Italian food over Chinese")
      * type: Memory category - Options include:
        Long-term: factual, preference, personal, skill, interest, habit, relationship
        Medium-term: contextual, task, location
        Short-term: temporal, event
      * importance: Rating 1-10 (higher = longer retention)

    - layer: Target memory layers (array):
      * user: User memories across all presets
      * preset: Shared memories for all users of this preset
      * guild: Guild-specific memories shared across all users in the same guild/group
      * global: Shared across all users and presets

    Usage timing: Use 'guild' layer when updating group chat-related memories. Use 'user' layer for individual user memories.

    This tool implements an update operation by deleting the specified memory IDs and adding new memories.
    Please search for memory IDs using the 'memory_search' tool before updating.

    Returns confirmation of updated memories count.`
}
