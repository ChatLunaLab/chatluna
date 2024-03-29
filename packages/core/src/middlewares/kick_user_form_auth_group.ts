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
                context.message = '你的权限不足以执行此操作。'
                return ChainMiddlewareRunStatus.STOP
            }

            const service = ctx.chatluna_auth

            const user = await service.getUser(session, userId)

            await service.removeUserFormGroup(user, name)

            context.message = `已将用户 ${userId} 踢出配额组 ${name}`

            return ChainMiddlewareRunStatus.STOP
        })
        .after('lifecycle-handle_command')
}

declare module '../chains/chain' {
    interface ChainMiddlewareName {
        kick_user_form_auth_group: never
    }
}
