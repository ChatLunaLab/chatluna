import { Context } from 'koishi'
import { Config } from '../config'
import { ChainMiddlewareRunStatus, ChatChain } from '../chains/chain'

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

            const service = ctx.chathub_auth

            const user = await service.getUser(session, userId)

            await service.addUserToGroup(user, name)

            context.message = `已将用户 ${userId} 添加到配额组 ${name}`

            return ChainMiddlewareRunStatus.STOP
        })
        .after('lifecycle-handle_command')
}

declare module '../chains/chain' {
    interface ChainMiddlewareName {
        add_user_to_auth_group: never
    }
}
