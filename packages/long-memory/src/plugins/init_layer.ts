import { Context } from 'koishi'
import { Config, MemoryRetrievalLayerInfo, MemoryRetrievalLayerType } from '..'
import { HippoRAGMemoryLayer } from '../layers/hippo/layer'
import { EmgasMemoryLayer } from '../layers/emgas'

export async function apply(ctx: Context, config: Config) {
    config.layerEngines.forEach((engine) => {
        ctx.chatluna_long_memory.putMemoryCreator(
            MemoryRetrievalLayerType[engine.layer],
            getMemoryCreator(config, engine.engine)
        )
    })
}

function getMemoryCreator(config: Config, engine: string) {
    switch (engine) {
        case 'HippoRAG':
            return (
                ctx: Context,
                info: MemoryRetrievalLayerInfo,
                layerType: MemoryRetrievalLayerType
            ) => new HippoRAGMemoryLayer(ctx, config, info)

        case 'Emgas':
            return (
                ctx: Context,
                info: MemoryRetrievalLayerInfo,
                layerType: MemoryRetrievalLayerType
            ) => new EmgasMemoryLayer(ctx, config, info)
    }
}
