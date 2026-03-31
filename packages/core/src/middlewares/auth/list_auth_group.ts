import { Context, Session } from 'koishi'
import { Config } from '../../config'
import { ChainMiddlewareRunStatus, ChatChain } from '../../chains/chain'
import { Pagination } from 'koishi-plugin-chatluna/utils/pagination'
import { ChatHubAuthGroup } from '../../authorization/types'

export function apply(ctx: Context, config: Config, chain: ChatChain) {
    const pagination = new Pagination<ChatHubAuthGroup>({
        formatItem: (value) => '',
        formatString: {
            top: '',
            bottom: '',
            pages: ''
        }
    })

    chain
        .middleware('list_auth_group', async (session, context) => {
            const {
                command,
                options: { page, limit, authPlatform }
            } = context

            if (command !== 'list_auth_group')
                return ChainMiddlewareRunStatus.SKIPPED

            pagination.updateFormatString({
                top: session.text('.header') + '\n',
                bottom: '\n' + session.text('.footer'),
                pages: '\n' + session.text('.pages')
            })

            pagination.updateFormatItem((value) =>
                formatAuthGroup(session, value)
            )

            const authGroups =
                await ctx.chatluna_auth.getAuthGroups(authPlatform)

            await pagination.push(authGroups)

            context.message = await pagination.getFormattedPage(page, limit)

            return ChainMiddlewareRunStatus.STOP
        })
        .after('lifecycle-handle_command')
        .before('lifecycle-request_conversation')
}

function formatAuthGroup(session: Session, group: ChatHubAuthGroup) {
    return session.text('.line', [
        group.name,
        group.platform ?? session.text('.general'),
        group.priority,
        group.limitPerMin,
        group.limitPerDay
    ])
}

declare module '../../chains/chain' {
    interface ChainMiddlewareName {
        list_auth_group: never
    }

    interface ChainMiddlewareContextOptions {
        authPlatform?: string
    }
}
