import { Context } from 'koishi'
import { Config } from '../config'
import { ChainMiddlewareRunStatus, ChatChain } from '../chains/chain'
import { checkAdmin } from '../chains/rooms'

export function apply(ctx: Context, config: Config, chain: ChatChain) {
    chain
        .middleware('add_user_to_auth_group', async (session, context) => {
            const { command } = context

            if (command !== 'add_user_to_auth_group')
                return ChainMiddlewareRunStatus.SKIPPED

            const {
                authUser: userId,
                auth_group_resolve: { name }
            } = context.options

            if (!(await checkAdmin(session))) {
                context.message = session.text('.permission_denied')
                return ChainMiddlewareRunStatus.STOP
            }

            const service = ctx.chatluna_auth

            const user = await service.getUser(session, userId)

            await service.addUserToGroup(user, name)

            context.message = session.text('.success', [userId, name])

            return ChainMiddlewareRunStatus.STOP
        })
        .after('lifecycle-handle_command')
}

declare module '../chains/chain' {
    interface ChainMiddlewareName {
        add_user_to_auth_group: never
    }
}
