import type { Context } from 'koishi'
import type { Config } from '../../config'
import { ChainMiddlewareRunStatus } from '../../chains/chain'
import type { ChatChain } from '../../chains/chain'
import type {} from '@koishijs/censor'
import { censorMessage } from '../../utils/message_content'

export function apply(ctx: Context, config: Config, chain: ChatChain) {
    chain
        .middleware('censor', async (session, context) => {
            const message = context.options.responseMessage

            if (!config.censor || message == null) {
                return ChainMiddlewareRunStatus.SKIPPED
            }

            message.content = (
                await censorMessage(
                    ctx,
                    message,
                    context.options.deliverySession ?? session
                )
            ).content
            return ChainMiddlewareRunStatus.CONTINUE
        })
        .before('lifecycle-send')
        .after('lifecycle-request_conversation')
}

declare module '../../chains/chain' {
    interface ChainMiddlewareName {
        censor: never
    }
}
