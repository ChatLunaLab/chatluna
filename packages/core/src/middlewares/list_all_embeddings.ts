import { Context } from 'koishi'
import { Config } from '../config'
import { ChainMiddlewareRunStatus, ChatChain } from '../chains/chain'
import { ModelType } from '../llm-core/platform/types'
import { Pagination } from '../utils/pagination'

export function apply(ctx: Context, config: Config, chain: ChatChain) {
    const service = ctx.chatluna.platform

    const pagination = new Pagination<string>({
        formatItem: (value) => value,
        formatString: {
            top: '以下是目前可用的嵌入模型列表：\n',
            bottom: '\n你可以使用 chathub.embeddings.set <model> 来设置默认使用的嵌入模型'
        }
    })

    chain
        .middleware('list_all_embeddings', async (session, context) => {
            const {
                command,
                options: { page, limit }
            } = context

            if (command !== 'list_embeddings')
                return ChainMiddlewareRunStatus.SKIPPED

            const models = service.getAllModels(ModelType.embeddings)

            await pagination.push(models)

            context.message = await pagination.getFormattedPage(page, limit)

            return ChainMiddlewareRunStatus.STOP
        })
        .after('lifecycle-handle_command')
}

declare module '../chains/chain' {
    interface ChainMiddlewareName {
        list_all_embeddings: never
    }
}
