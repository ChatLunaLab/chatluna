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

        // 清理聊天历史时清理长期记忆缓存
        ctx.on(
            'chatluna/clear-chat-history',
            async (conversationId, _chatInterface) => {
                // 删除特定会话的记忆层
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
        if (this._memoryLayerInfos[conversationId] == null) {
            this._memoryLayerInfos[conversationId] = await Promise.all(
                (Array.isArray(types) ? types : [types]).map(
                    async (layerType) => {
                        const creator = this._memoryLayerCreators[layerType]

                        if (creator == null) {
                            throw new Error(
                                `Memory layer ${layerType} not found`
                            )
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
                    }
                )
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
}

declare module 'koishi' {
    export interface Context {
        chatluna_long_memory: ChatLunaLongMemoryService
    }
}
