import { Context } from 'koishi'

import { ChainMiddlewareRunStatus, ChatChain } from '../../chains/chain'
import { Config } from '../../config'
import { Pagination } from 'koishi-plugin-chatluna/utils/pagination'

export function apply(ctx: Context, config: Config, chain: ChatChain) {
    const services = ctx.chatluna.platform

    const pagination = new Pagination<string>({
        formatItem: (value) => value,
        formatString: {
            top: '',
            bottom: '',
            pages: ''
        }
    })

    chain
        .middleware('list_all_tool', async (session, context) => {
            const {
                command,
                options: { page, limit }
            } = context

            if (command !== 'list_tool') return ChainMiddlewareRunStatus.SKIPPED

            pagination.updateFormatString({
                top: session.text('.header') + '\n',
                bottom: '\n' + session.text('.footer'),
                pages: '\n' + session.text('.pages')
            })

            const tools = services.getTools().value.sort((a, b) => {
                return a.localeCompare(b, undefined, {
                    numeric: true,
                    sensitivity: 'base'
                })
            })

            await pagination.push(tools)

            context.message = await pagination.getFormattedPage(page, limit)

            return ChainMiddlewareRunStatus.STOP
        })
        .after('lifecycle-handle_command')
        .before('lifecycle-request_model')
}

declare module '../../chains/chain' {
    interface ChainMiddlewareName {
        list_all_tool: never
    }
}
