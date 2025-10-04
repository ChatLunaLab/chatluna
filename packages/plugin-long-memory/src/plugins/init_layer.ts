import { Context } from 'koishi'
import {
    Config,
    logger,
    MemoryRetrievalLayerInfo,
    MemoryRetrievalLayerType
} from '..'
import { HippoRAGMemoryLayer } from '../layers/hippo/layer'
import { EmgasMemoryLayer } from '../layers/emgas'
import { BasicMemoryLayer } from '../layers/basic'

export async function apply(ctx: Context, config: Config) {
    config.layerEngines.forEach((engine) => {
        ctx.chatluna_long_memory.putMemoryCreator(
            MemoryRetrievalLayerType[
                engine.layer.toUpperCase() as keyof typeof MemoryRetrievalLayerType
            ],
            getMemoryCreator(config, engine.engine)
        )
    })
}

function getMemoryCreator(config: Config, engine: string) {
    switch (engine) {
        case 'Basic':
            return (
                ctx: Context,
                info: Required<MemoryRetrievalLayerInfo>,
                layerType: MemoryRetrievalLayerType
            ) => new BasicMemoryLayer(ctx, config, info)

        case 'HippoRAG':
            return (
                ctx: Context,
                info: Required<MemoryRetrievalLayerInfo>,
                layerType: MemoryRetrievalLayerType
            ) => new HippoRAGMemoryLayer(ctx, config, info)

        case 'Emgas':
            return (
                ctx: Context,
                info: Required<MemoryRetrievalLayerInfo>,
                layerType: MemoryRetrievalLayerType
            ) => new EmgasMemoryLayer(ctx, config, info)
    }

    logger.error(`Unknown memory retrieval layer engine: ${engine}`)

    return undefined
}
