import { Context, h } from 'koishi';
import { Config } from '../config';
import { ChatChain } from '../chain';
import { createLogger } from '@dingyi222666/chathub-llm-core/lib/utils/logger';

const logger = createLogger("@dingyi222666/chathub/middlewares/thinking_message_send")

export function apply(ctx: Context, config: Config, chain: ChatChain) {
    chain.middleware("thinking_message_send", async (session, context) => {

        if (!config.sendThinkingMessage) {
            return true
        }

        const thinkingTimeoutObject: ThinkingTimeoutObject = {}
        context.options.thinkingTimeoutObject = thinkingTimeoutObject

        thinkingTimeoutObject.timeout = setTimeout(async () => {
            const messageIds = await session.send(h.text(config.thinkingMessage))
            logger.debug(`[thinking_message_send] messageIds: ${messageIds}`)
            thinkingTimeoutObject.recallFunc = async () => {
                try {
                    await session.bot.deleteMessage(session.channelId, messageIds[0])
                } catch (e) {
                    logger.error(e)
                }
            }

        }, config.sendThinkingMessageTimeout)

        return true
    }).before("lifecycle-prepare")
}

export type ThinkingTimeoutObject = { timeout?: NodeJS.Timeout, recallFunc?: () => PromiseLike<void> }

declare module '../chain' {
    interface ChainMiddlewareContextOptions {
        thinkingTimeoutObject?: ThinkingTimeoutObject
    }

    interface ChainMiddlewareName {
        thinking_message_send: never
    }
}