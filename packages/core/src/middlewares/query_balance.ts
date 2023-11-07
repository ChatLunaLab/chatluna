import { Context } from 'koishi'
import { Config } from '../config'
import { ChainMiddlewareRunStatus, ChatChain } from '../chains/chain'

export function apply(ctx: Context, config: Config, chain: ChatChain) {
    chain
        .middleware('query_balance', async (session, context) => {
            const { command } = context

            if (command !== 'query_balance')
                return ChainMiddlewareRunStatus.SKIPPED

            const { authUser: userId } = context.options

            const service = ctx.chatluna_auth

            const user = await service.getUser(session, userId)

            context.message = `用户 ${userId} 当前的账户余额为 ${user.balance}`

            return ChainMiddlewareRunStatus.STOP
        })
        .after('lifecycle-handle_command')
}

declare module '../chains/chain' {
    interface ChainMiddlewareName {
        query_balance: never
    }
}
