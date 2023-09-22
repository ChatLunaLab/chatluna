import { Context } from 'koishi'
import { Config } from '../config'
import { ChainMiddlewareRunStatus, ChatChain } from '../chains/chain'
import type {} from '@koishijs/censor'

export function apply(ctx: Context, config: Config, chain: ChatChain) {
    chain
        .middleware('censor', async (session, context) => {
            if (!config.censor) {
                return ChainMiddlewareRunStatus.SKIPPED
            }

            const message = context.options.responseMessage

            message.content = await ctx.censor.transform(
                message.content,
                session
            )
        })
        .after('request_model')
    //  .before("lifecycle-request_model")
}

declare module '../chains/chain' {
    interface ChainMiddlewareName {
        censor: never
    }
}
