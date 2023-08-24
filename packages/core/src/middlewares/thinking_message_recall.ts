import { Context, h } from 'koishi';
import { Config } from '../config';
import { ChainMiddlewareRunStatus, ChatChain } from '../chains/chain';
import { createLogger } from '../llm-core/utils/logger';

const logger = createLogger("@dingyi222666/chathub/middlewares/thinking_message_recall")

export function apply(ctx: Context, config: Config, chain: ChatChain) {
    chain.middleware("thinking_message_recall", async (session, context) => {

        if (!config.sendThinkingMessage) {
            return ChainMiddlewareRunStatus.SKIPPED
        }

        await context.recallThinkingMessage?.()
        return ChainMiddlewareRunStatus.CONTINUE
    }).after("render_message")
}

declare module '../chains/chain' {
    interface ChainMiddlewareName {
        thinking_message_recall: never
    }
}

