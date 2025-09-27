import { Context, Service } from 'koishi'
import {
    Config,
    CreateMemoryLayersFunction,
    EnhancedMemory,
    MemoryRetrievalLayerInfo,
    MemoryRetrievalLayerType
} from '..'
import {
    BaseMemoryRetrievalLayer,
    resolveLongMemoryId,
    sortMemoryRetrievalLayerType
} from '../utils/layer'

export class ChatLunaLongMemoryService extends Service {
    private _memoryLayerInfos: Record<string, BaseMemoryRetrievalLayer[]> = {}

    public readonly defaultLayerTypes: MemoryRetrievalLayerType[] = []

    private _memoryLayerCreators: Record<string, CreateMemoryLayersFunction> =
        {}

    constructor(
        public readonly ctx: Context,
        public config: Config
    ) {
        super(ctx, 'chatluna_long_memory', true)

        const mapped = config.enabledLayers
            .map(
                (layer) =>
                    MemoryRetrievalLayerType[
                        layer.toUpperCase() as keyof typeof MemoryRetrievalLayerType
                    ]
            )
            .filter((v): v is MemoryRetrievalLayerType => v != null)

        this.defaultLayerTypes.push(...mapped)

        ctx.on(
            'chatluna/clear-chat-history',
            async (conversationId, _chatInterface) => {
                delete this._memoryLayerInfos[conversationId]
            }
        )

        // 定期清理过期记忆
        ctx.setInterval(
            async () => {
                for (const [, layers] of Object.entries(
                    this._memoryLayerInfos
                )) {
                    for (const layer of layers) {
                        await layer.cleanupExpiredMemories()
                    }
                }
            },
            1000 * 10 * 60 * 10
        ) // 每10分钟清理一次过期记忆
    }

    async initMemoryLayers(
        conversationId: string,
        info: MemoryRetrievalLayerInfo,
        types: MemoryRetrievalLayerType | MemoryRetrievalLayerType[] = this
            .defaultLayerTypes
    ) {
        const layerTypes = Array.isArray(types) ? types : [types]
        if (
            this._memoryLayerInfos[conversationId] == null ||
            this._memoryLayerInfos[conversationId].some(
                (layer) => !layerTypes.includes(layer.info.type)
            )
        ) {
            this._memoryLayerInfos[conversationId] = await Promise.all(
                layerTypes.map(async (layerType) => {
                    const creator = this._memoryLayerCreators[layerType]

                    if (creator == null) {
                        throw new Error(`Memory layer ${layerType} not found`)
                    }

                    const cloneOfInfo = {
                        ...info,
                        memoryId: resolveLongMemoryId(
                            info.presetId,
                            info.userId,
                            layerType
                        ),
                        type: layerType
                    }

                    const layer = creator(this.ctx, cloneOfInfo, layerType)

                    await layer.initialize()

                    return layer
                })
            )
        }

        return this._memoryLayerInfos[conversationId]
    }

    getMemoryLayers(
        conversationId: string
    ): BaseMemoryRetrievalLayer[] | undefined {
        return this._memoryLayerInfos[conversationId]
    }

    getMemoryLayersByType(
        conversationId: string,
        type: MemoryRetrievalLayerType | MemoryRetrievalLayerType[] = this
            .defaultLayerTypes
    ) {
        const baseLayers = this.getMemoryLayers(conversationId)

        if (baseLayers == null) {
            return []
        }

        const selectLayer = (layerType: MemoryRetrievalLayerType) => {
            if (Array.isArray(type)) {
                return type.includes(layerType)
            }
            return type === layerType
        }

        return baseLayers.filter((layer) => selectLayer(layer.info.type))
    }

    putMemoryLayers(
        conversationId: string,
        memoryLayers: BaseMemoryRetrievalLayer[]
    ) {
        this._memoryLayerInfos[conversationId] = memoryLayers
    }

    putMemoryCreator(
        type: MemoryRetrievalLayerType,
        creator: CreateMemoryLayersFunction
    ) {
        this._memoryLayerCreators[type] = creator
    }

    async retrieveMemory(
        conversationId: string,
        searchContent: string,
        types: MemoryRetrievalLayerType | MemoryRetrievalLayerType[] = this
            .defaultLayerTypes
    ): Promise<EnhancedMemory[]> {
        const memoryLayers = this.getMemoryLayersByType(conversationId, types)

        if (memoryLayers.length === 0) {
            return []
        }

        return await Promise.all(
            memoryLayers
                .map(
                    (layer) =>
                        [layer, layer.retrieveMemory(searchContent)] as const
                )
                .sort((a, b) =>
                    sortMemoryRetrievalLayerType(a[0].info.type, b[0].info.type)
                )
                .map(([, memory]) => memory)
        ).then((memories) => memories.flat())
    }

    async getMemoriesByIds(
        conversationId: string,
        memoryIds: string[],
        types: MemoryRetrievalLayerType | MemoryRetrievalLayerType[] = this
            .defaultLayerTypes
    ): Promise<EnhancedMemory[]> {
        const memoryLayers = this.getMemoryLayersByType(conversationId, types)

        if (memoryLayers.length === 0) {
            return []
        }

        // For now, we'll need to implement this in the base layer
        // Since the current layers don't have a getMemoriesByIds method,
        // we'll retrieve all memories and filter by IDs
        const allMemoriesPromises = memoryLayers.map((layer) =>
            layer.retrieveMemory('')
        )
        const allMemoriesArrays = await Promise.all(allMemoriesPromises)
        const allMemories = allMemoriesArrays.flat()

        // Filter by the requested IDs
        return allMemories.filter((memory) => memoryIds.includes(memory.id))
    }

    async addMemories(
        conversationId: string,
        memories: EnhancedMemory[],
        types:
            | MemoryRetrievalLayerType
            | MemoryRetrievalLayerType[] = MemoryRetrievalLayerType.USER
    ): Promise<void> {
        const memoryLayers = this.getMemoryLayersByType(conversationId, types)

        if (memoryLayers.length === 0) {
            return
        }

        await Promise.all(
            memoryLayers.map((layer) => layer.addMemories(memories))
        )
    }

    async clear(
        conversationId: string,
        types:
            | MemoryRetrievalLayerType
            | MemoryRetrievalLayerType[] = MemoryRetrievalLayerType.USER
    ): Promise<void> {
        const memoryLayers = this.getMemoryLayersByType(conversationId, types)

        if (memoryLayers.length === 0) {
            return
        }

        await Promise.all(memoryLayers.map((layer) => layer.clearMemories()))
    }

    async deleteMemories(
        conversationId: string,
        memoryIds: string[],
        types:
            | MemoryRetrievalLayerType
            | MemoryRetrievalLayerType[] = MemoryRetrievalLayerType.USER
    ): Promise<void> {
        const memoryLayers = this.getMemoryLayersByType(conversationId, types)

        if (memoryLayers.length === 0) {
            return
        }

        await Promise.all(
            memoryLayers.map((layer) => layer.deleteMemories(memoryIds))
        )
    }

    async updateMemories(
        conversationId: string,
        memoryIds: string[],
        newMemories: EnhancedMemory[],
        types:
            | MemoryRetrievalLayerType
            | MemoryRetrievalLayerType[] = MemoryRetrievalLayerType.USER
    ): Promise<void> {
        if (memoryIds.length !== newMemories.length) {
            throw new Error(
                `Memory IDs count (${memoryIds.length}) must match new memories count (${newMemories.length})`
            )
        }

        const memoryLayers = this.getMemoryLayersByType(conversationId, types)

        if (memoryLayers.length === 0) {
            return
        }

        // Backup original memories before attempting update
        const originalMemories = await this.getMemoriesByIds(
            conversationId,
            memoryIds,
            types
        )

        // Preserve the original IDs for the new memories to maintain ID stability
        const updatedMemories = newMemories.map((memory, index) => ({
            ...memory,
            id: memoryIds[index]
        }))

        // Perform atomic update for each layer with rollback capability
        const failedLayers: BaseMemoryRetrievalLayer[] = []

        try {
            for (const layer of memoryLayers) {
                try {
                    await layer.deleteMemories(memoryIds)
                    await layer.addMemories(updatedMemories)
                } catch (error) {
                    failedLayers.push(layer)
                    throw error
                }
            }
        } catch (error) {
            // Rollback: restore original memories to layers that succeeded
            const succeededLayers = memoryLayers.filter(
                (layer) => !failedLayers.includes(layer)
            )

            if (succeededLayers.length > 0 && originalMemories.length > 0) {
                try {
                    await Promise.all(
                        succeededLayers.map(async (layer) => {
                            // Remove the updated memories and restore originals
                            await layer.deleteMemories(memoryIds)
                            await layer.addMemories(originalMemories)
                        })
                    )
                } catch (rollbackError) {
                    // If rollback fails, log the error but still throw the original error
                    this.ctx.logger.error(
                        'Failed to rollback memory update:',
                        rollbackError
                    )
                }
            }

            throw error
        }
    }
}

declare module 'koishi' {
    export interface Context {
        chatluna_long_memory: ChatLunaLongMemoryService
    }
}
