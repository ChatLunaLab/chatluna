import { Context, h } from 'koishi';
import { Config } from '../config';
import { ChainMiddlewareRunStatus, ChatChain } from '../chain';
import { createLogger } from '../llm-core/utils/logger';

const logger = createLogger("@dingyi222666/chathub/middlewares/thinking_message_recall")

export function apply(ctx: Context, config: Config, chain: ChatChain) {
    chain.middleware("thinking_message_recall", async (session, context) => {

        if (!config.sendThinkingMessage) {
            return ChainMiddlewareRunStatus.SKIPPED
        }

        const thinkingTimeoutObject = context.options.thinkingTimeoutObject
        context.options.thinkingTimeoutObject = thinkingTimeoutObject

        clearTimeout(thinkingTimeoutObject.timeout)

        if (thinkingTimeoutObject.recallFunc) {
            await thinkingTimeoutObject.recallFunc()
        }

        return ChainMiddlewareRunStatus.CONTINUE
    }).after("render_message")
}

declare module '../chain' {
    interface ChainMiddlewareName {
        thinking_message_recall: never
    }
}

