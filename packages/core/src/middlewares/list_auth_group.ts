import { Context, Session } from 'koishi'
import { Config } from '../config'
import { ChainMiddlewareRunStatus, ChatChain } from '../chains/chain'
import { Pagination } from 'koishi-plugin-chatluna/utils/pagination'
import { ChatHubAuthGroup } from '../authorization/types'

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
}

function formatAuthGroup(session: Session, group: ChatHubAuthGroup) {
    const buffer: string[] = []

    buffer.push(session.text('.name', [group.name]))
    buffer.push(
        session.text('.platform', [group.platform ?? session.text('.general')])
    )
    buffer.push(session.text('.cost', [group.costPerToken]))
    buffer.push(session.text('.priority', [group.priority]))
    buffer.push(
        session.text('.support_models', [
            group.supportModels?.join(', ') ?? session.text('.general')
        ])
    )
    buffer.push(session.text('.limit_per_min', [group.limitPerMin]))
    buffer.push(session.text('.limit_per_day', [group.limitPerDay]))

    buffer.push('\n')

    return buffer.join('\n')
}

declare module '../chains/chain' {
    interface ChainMiddlewareName {
        list_auth_group: never
    }

    interface ChainMiddlewareContextOptions {
        authPlatform?: string
    }
}
