import { Context } from 'koishi'
import { ModelType } from 'koishi-plugin-chatluna/llm-core/platform/types'
import { ChainMiddlewareRunStatus, ChatChain } from '../chains/chain'
import { Config } from '../config'
import { Pagination } from 'koishi-plugin-chatluna/utils/pagination'

export function apply(ctx: Context, config: Config, chain: ChatChain) {
    const service = ctx.chatluna.platform

    const pagination = new Pagination<string>({
        formatItem: (value) => value,
        formatString: {
            top: '',
            bottom: '',
            pages: ''
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

            pagination.updateFormatString({
                top: session.text('.header') + '\n',
                bottom: '\n' + session.text('.footer'),
                pages: '\n' + session.text('.pages')
            })

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
