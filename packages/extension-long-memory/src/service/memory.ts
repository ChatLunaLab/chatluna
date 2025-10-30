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
    private _memoryLayerNamespaces: Record<string, BaseMemoryRetrievalLayer[]> =
        {}

    private _memoryLayers: Record<string, BaseMemoryRetrievalLayer> = {}

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
                delete this._memoryLayerNamespaces[conversationId]
            }
        )

        // 定期清理过期记忆
        ctx.setInterval(
            async () => {
                for (const [, layers] of Object.entries(
                    this._memoryLayerNamespaces
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
        info: MemoryRetrievalLayerInfo,
        namespace: string,
        types: MemoryRetrievalLayerType | MemoryRetrievalLayerType[] = this
            .defaultLayerTypes
    ) {
        const layerTypes = Array.isArray(types) ? types : [types]

        const resolveLayers = () => {
            return layerTypes
                .map(
                    (layerType) =>
                        this._memoryLayers[resolveLongMemoryId(info, layerType)]
                )
                .filter((layer): layer is BaseMemoryRetrievalLayer => !!layer)
        }

        let layers = resolveLayers()

        if (layers.length === layerTypes.length) {
            return layers
        }

        if (
            this._memoryLayerNamespaces[namespace] == null ||
            this._memoryLayerNamespaces[namespace].some(
                (layer) => !layerTypes.includes(layer.info.type)
            )
        ) {
            this._memoryLayerNamespaces[namespace] = await Promise.all(
                layerTypes.map(async (layerType) => {
                    const creator = this._memoryLayerCreators[layerType]

                    if (creator == null) {
                        throw new Error(`Memory layer ${layerType} not found`)
                    }

                    const cloneOfInfo = {
                        ...info,
                        memoryId: resolveLongMemoryId(info, layerType),
                        type: layerType
                    }

                    const layer = creator(this.ctx, cloneOfInfo, layerType)

                    await layer.initialize()

                    this._memoryLayers[cloneOfInfo.memoryId] = layer

                    return layer
                })
            )
        }

        layers = resolveLayers()

        return layers
    }

    getMemoryLayers(
        info: MemoryRetrievalLayerInfo,
        types: MemoryRetrievalLayerType | MemoryRetrievalLayerType[]
    ): BaseMemoryRetrievalLayer[] | undefined

    getMemoryLayers(namespace: string): BaseMemoryRetrievalLayer[] | undefined

    getMemoryLayers(
        info: string | MemoryRetrievalLayerInfo,
        types: MemoryRetrievalLayerType | MemoryRetrievalLayerType[] = this
            .defaultLayerTypes
    ): BaseMemoryRetrievalLayer[] | undefined {
        if (typeof info === 'string') {
            return this._memoryLayerNamespaces[info]
        }
        const layerTypes = Array.isArray(types) ? types : [types]

        return layerTypes
            .map(
                (layerType) =>
                    this._memoryLayers[resolveLongMemoryId(info, layerType)]
            )
            .filter((layer): layer is BaseMemoryRetrievalLayer => !!layer)
    }

    putMemoryCreator(
        type: MemoryRetrievalLayerType,
        creator: CreateMemoryLayersFunction
    ) {
        this._memoryLayerCreators[type] = creator
    }

    async retrieveMemory(
        info: MemoryRetrievalLayerInfo,
        searchContent: string,
        types: MemoryRetrievalLayerType | MemoryRetrievalLayerType[] = this
            .defaultLayerTypes
    ): Promise<EnhancedMemory[]> {
        const memoryLayers = this.getMemoryLayers(info, types)

        if (!memoryLayers || memoryLayers.length === 0) {
            return []
        }

        return await Promise.all(
            memoryLayers
                .filter((layer): layer is BaseMemoryRetrievalLayer => !!layer)
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
        info: MemoryRetrievalLayerInfo,
        memoryIds: string[],
        types: MemoryRetrievalLayerType | MemoryRetrievalLayerType[] = this
            .defaultLayerTypes
    ): Promise<EnhancedMemory[]> {
        const memoryLayers = this.getMemoryLayers(info, types)

        if (!memoryLayers || memoryLayers.length === 0) {
            return []
        }

        // For now, we'll need to implement this in the base layer
        // Since the current layers don't have a getMemoriesByIds method,
        // we'll retrieve all memories and filter by IDs
        const allMemoriesPromises = memoryLayers
            .filter((layer): layer is BaseMemoryRetrievalLayer => !!layer)
            .map((layer) => layer.retrieveMemory(''))
        const allMemoriesArrays = await Promise.all(allMemoriesPromises)
        const allMemories = allMemoriesArrays.flat()

        // Filter by the requested IDs
        return allMemories.filter((memory) => memoryIds.includes(memory.id))
    }

    async addMemories(
        info: MemoryRetrievalLayerInfo,
        memories: EnhancedMemory[],
        types:
            | MemoryRetrievalLayerType
            | MemoryRetrievalLayerType[] = MemoryRetrievalLayerType.USER
    ): Promise<void> {
        const memoryLayers = this.getMemoryLayers(info, types)

        if (!memoryLayers || memoryLayers.length === 0) {
            return
        }

        await Promise.all(
            memoryLayers
                .filter((layer): layer is BaseMemoryRetrievalLayer => !!layer)
                .map((layer) => layer.addMemories(memories))
        )
    }

    async clear(
        info: MemoryRetrievalLayerInfo,
        types:
            | MemoryRetrievalLayerType
            | MemoryRetrievalLayerType[] = MemoryRetrievalLayerType.USER
    ): Promise<void> {
        const memoryLayers = this.getMemoryLayers(info, types)

        if (!memoryLayers || memoryLayers.length === 0) {
            return
        }

        await Promise.all(
            memoryLayers
                .filter((layer): layer is BaseMemoryRetrievalLayer => !!layer)
                .map((layer) => layer.clearMemories())
        )
    }

    async deleteMemories(
        info: MemoryRetrievalLayerInfo,
        memoryIds: string[],
        types:
            | MemoryRetrievalLayerType
            | MemoryRetrievalLayerType[] = MemoryRetrievalLayerType.USER
    ): Promise<void> {
        const memoryLayers = this.getMemoryLayers(info, types)

        if (!memoryLayers || memoryLayers.length === 0) {
            return
        }

        await Promise.all(
            memoryLayers
                .filter((layer): layer is BaseMemoryRetrievalLayer => !!layer)
                .map((layer) => layer.deleteMemories(memoryIds))
        )
    }

    async updateMemories(
        info: MemoryRetrievalLayerInfo,
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

        const memoryLayers = this.getMemoryLayers(info, types)

        if (!memoryLayers || memoryLayers.length === 0) {
            return
        }

        const filteredLayers = memoryLayers.filter(
            (layer): layer is BaseMemoryRetrievalLayer => !!layer
        )

        if (filteredLayers.length === 0) {
            return
        }

        // Backup original memories before attempting update
        const originalMemories = await this.getMemoriesByIds(
            info,
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
            for (const layer of filteredLayers) {
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
            const succeededLayers = filteredLayers.filter(
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

    static inject = ['chatluna', 'database']
}

declare module 'koishi' {
    export interface Context {
        chatluna_long_memory: ChatLunaLongMemoryService
    }
}
