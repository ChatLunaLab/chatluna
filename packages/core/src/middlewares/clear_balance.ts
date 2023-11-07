import { Context } from 'koishi'
import { Config } from '../config'
import { ChainMiddlewareRunStatus, ChatChain } from '../chains/chain'

export function apply(ctx: Context, config: Config, chain: ChatChain) {
    chain
        .middleware('clear_balance', async (session, context) => {
            const { command } = context

            if (command !== 'clear_balance')
                return ChainMiddlewareRunStatus.SKIPPED

            const { authUser: userId } = context.options

            const service = ctx.chatluna_auth

            const user = await service.getUser(session, userId)

            const modifiedBalance = await service.modifyBalance(
                session,
                -user.balance,
                userId
            )

            context.message = `已将用户 ${userId} 账户余额修改为 ${modifiedBalance}`

            return ChainMiddlewareRunStatus.STOP
        })
        .after('lifecycle-handle_command')
}

declare module '../chains/chain' {
    interface ChainMiddlewareName {
        clear_balance: never
    }
}
