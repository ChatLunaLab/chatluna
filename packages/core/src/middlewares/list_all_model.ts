import { Context } from 'koishi'
import { Config } from '../config'
import { ChainMiddlewareRunStatus, ChatChain } from '../chains/chain'

import { ModelType } from '../llm-core/platform/types'
import { Pagination } from '../utils/pagination'

export function apply(ctx: Context, config: Config, chain: ChatChain) {
    const services = ctx.chatluna.platform

    const pagination = new Pagination<string>({
        formatItem: (value) => value,
        formatString: {
            top: '以下是目前可用的模型列表：\n',
            bottom: '\n你可以使用 chathub.room.set -m <model> 来设置默认使用的模型'
        }
    })

    chain
        .middleware('list_all_model', async (session, context) => {
            const {
                command,
                options: { page, limit }
            } = context

            if (command !== 'list_model')
                return ChainMiddlewareRunStatus.SKIPPED

            const models = services.getAllModels(ModelType.llm)

            await pagination.push(models)

            context.message = await pagination.getFormattedPage(page, limit)

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
