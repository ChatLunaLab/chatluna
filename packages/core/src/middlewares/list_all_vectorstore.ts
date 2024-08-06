import { Context } from 'koishi'
import { Config } from '../config'
import { ChainMiddlewareRunStatus, ChatChain } from '../chains/chain'
import { Pagination } from 'koishi-plugin-chatluna/utils/pagination'

export function apply(ctx: Context, config: Config, chain: ChatChain) {
    const service = ctx.chatluna.platform

    const pagination = new Pagination<string>({
        formatItem: (value) => value,
        formatString: {
            top: '以下是目前可用的向量数据库列表：\n',
            bottom: '\n你你可以使用 chatluna.vectorstore.set <model> 来设置默认使用的向量数据库（如果没有任何向量数据库，会使用存储在内存里的向量数据库（临时的））'
        }
    })

    chain
        .middleware('list_all_vectorstore', async (session, context) => {
            const {
                command,
                options: { page, limit }
            } = context

            if (command !== 'list_vector_store')
                return ChainMiddlewareRunStatus.SKIPPED

            const vectorStoreProviders = service.getVectorStoreRetrievers()

            await pagination.push(vectorStoreProviders)

            context.message = await pagination.getFormattedPage(page, limit)

            return ChainMiddlewareRunStatus.STOP
        })
        .after('lifecycle-handle_command')
}

declare module '../chains/chain' {
    interface ChainMiddlewareName {
        list_all_vectorstore: never
    }
}
