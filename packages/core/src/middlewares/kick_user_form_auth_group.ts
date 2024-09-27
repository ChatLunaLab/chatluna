import { Context } from 'koishi'
import { Config } from '../config'
import { ChainMiddlewareRunStatus, ChatChain } from '../chains/chain'
import { checkAdmin } from '../chains/rooms'

export function apply(ctx: Context, config: Config, chain: ChatChain) {
    chain
        .middleware('kick_user_form_auth_group', async (session, context) => {
            const { command } = context

            if (command !== 'kick_user_form_auth_group')
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

            await service.removeUserFormGroup(user, name)

            context.message = session.text('.success', [userId, name])

            return ChainMiddlewareRunStatus.STOP
        })
        .after('lifecycle-handle_command')
}

declare module '../chains/chain' {
    interface ChainMiddlewareName {
        kick_user_form_auth_group: never
    }
}
