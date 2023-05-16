import { Context, h } from 'koishi';
import { Config } from '../config';
import { ChatChain } from '../chain';
import { createLogger } from '@dingyi222666/chathub-llm-core/lib/utils/logger';

const logger = createLogger("@dingyi222666/chathub/middlewares/thinking_message_recall")

export function apply(ctx: Context, config: Config, chain: ChatChain) {
    chain.middleware("thinking_message_recall", async (session, context) => {

        if (!config.sendThinkingMessage) {
            return true
        }

        const thinkingTimeoutObject =  context.options.thinkingTimeoutObject 
        context.options.thinkingTimeoutObject = thinkingTimeoutObject
       
        clearTimeout(thinkingTimeoutObject.timeout)

        if (thinkingTimeoutObject.recallFunc) {
            await thinkingTimeoutObject.recallFunc()
        }

        return true
    }).after("render_message")
}

declare module '../chain' { 
    interface ChainMiddlewareName {
        thinking_message_recall: never
    }
}

