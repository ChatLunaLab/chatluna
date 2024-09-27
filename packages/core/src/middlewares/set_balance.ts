import { Context } from 'koishi'
import { ChainMiddlewareRunStatus, ChatChain } from '../chains/chain'
import { Config } from '../config'

export function apply(ctx: Context, config: Config, chain: ChatChain) {
    chain
        .middleware('set_balance', async (session, context) => {
            const { command } = context

            if (command !== 'set_balance')
                return ChainMiddlewareRunStatus.SKIPPED

            const { authUser: userId, balance } = context.options

            const service = ctx.chatluna_auth

            const modifiedBalance = await service.setBalance(
                session,
                balance,
                userId
            )

            context.message = session.text('.success', [
                userId,
                modifiedBalance
            ])

            return ChainMiddlewareRunStatus.STOP
        })
        .after('lifecycle-handle_command')
}

declare module '../chains/chain' {
    interface ChainMiddlewareName {
        set_balance: never
    }

    interface ChainMiddlewareContextOptions {
        authUser?: string
        balance?: number
    }
}
