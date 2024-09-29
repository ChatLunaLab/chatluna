import { Context, Schema } from 'koishi'
import { Config } from '..'
import { PlatformService } from 'koishi-plugin-chatluna/llm-core/platform/service'
import { ModelType } from 'koishi-plugin-chatluna/llm-core/platform/types'

export async function apply(ctx: Context, config: Config) {
    ctx.on('chatluna/model-added', async (service) => {
        ctx.schema.set('model', Schema.union(await getModelNames(service)))
    })

    ctx.on('chatluna/model-removed', async (service) => {
        ctx.schema.set('model', Schema.union(await getModelNames(service)))
    })

    ctx.schema.set(
        'model',
        Schema.union(await getModelNames(ctx.chatluna.platform))
    )
}

async function getModelNames(service: PlatformService) {
    return service.getAllModels(ModelType.llm).map((m) => Schema.const(m))
}
