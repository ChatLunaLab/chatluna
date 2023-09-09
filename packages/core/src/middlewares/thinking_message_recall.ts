import { Context } from 'koishi'
import { Config } from '../config'
import { ChainMiddlewareRunStatus, ChatChain } from '../chains/chain'

export function apply(ctx: Context, config: Config, chain: ChatChain) {
    chain
        .middleware('thinking_message_recall', async (session, context) => {
            if (!config.sendThinkingMessage) {
                return ChainMiddlewareRunStatus.SKIPPED
            }

            await context.recallThinkingMessage?.()
            return ChainMiddlewareRunStatus.CONTINUE
        })
        .after('render_message')
}

declare module '../chains/chain' {
    interface ChainMiddlewareName {
        thinking_message_recall: never
    }
}
