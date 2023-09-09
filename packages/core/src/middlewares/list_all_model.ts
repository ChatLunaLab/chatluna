import { Context, h } from 'koishi'
import { Config } from '../config'
import { ChainMiddlewareRunStatus, ChatChain } from '../chains/chain'
import { createLogger } from '../utils/logger'

import { ModelType } from '../llm-core/platform/types'
import { CacheMap } from '../utils/queue'

const logger = createLogger()

export function apply(ctx: Context, config: Config, chain: ChatChain) {
    const services = ctx.chathub.platform

    const cacheMap = new CacheMap<string[]>()

    chain
        .middleware('list_all_model', async (session, context) => {
            const {
                command,
                options: { page, limit }
            } = context

            if (command !== 'list_model') return ChainMiddlewareRunStatus.SKIPPED

            let models = services.getAllModels(ModelType.llm)

            await cacheMap.set('default', models, (a, b) => {
                if (a.length !== b.length) return false
                const sortedA = a.sort()
                const sortedB = b.sort()

                return sortedA.every((value, index) => value === sortedB[index])
            })

            models = await cacheMap.get('default')

            const buffer: string[] = ['以下是目前可用的模型列表：\n']

            const rangeModels = models.slice((page - 1) * limit, Math.min(models.length, page * limit))

            for (const model of rangeModels) {
                buffer.push(model)
            }

            buffer.push('\n你可以使用 chathub.room.set -m <model> 来设置默认使用的模型')
            buffer.push(`\n当前为第 ${page} / ${Math.ceil(models.length / limit)} 页`)

            context.message = buffer.join('\n')

            return ChainMiddlewareRunStatus.STOP
        })
        .after('lifecycle-handle_command')
}

declare module '../chains/chain' {
    interface ChainMiddlewareName {
        list_all_model: never
    }

    interface ChainMiddlewareContextOptions {
        page?: number
        limit?: number
    }
}
