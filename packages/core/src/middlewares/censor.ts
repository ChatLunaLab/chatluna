import { Context, h } from 'koishi';
import { Config } from '../config';
import { ChainMiddlewareContext, ChainMiddlewareRunStatus, ChatChain } from '../chain';
import type { } from '@koishijs/censor'

export function apply(ctx: Context, config: Config, chain: ChatChain) {

    chain.middleware("censor", async (session, context) => {

        if (!config.censor) {
            return ChainMiddlewareRunStatus.SKIPPED
        }

        const message = context.options.responseMessage

        message.text = await ctx.censor.transform(message.text, session)

    }).after("request_model")
    //  .before("lifecycle-request_model")

}

declare module '../chain' {
    interface ChainMiddlewareName {
        "censor": never
    }
}


