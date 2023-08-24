import { Context } from 'koishi';
import { Config } from '../config';
import { ChainMiddlewareRunStatus, ChatChain } from '../chains/chain';
import { createLogger } from '../llm-core/utils/logger';


const logger = createLogger("@dingyi222666/chathub/middlewares/cooldown_time")

let lastChatTime = 0

export function apply(ctx: Context, config: Config, chain: ChatChain) {
    chain.middleware("cooldown_time", async (session, context) => {
        const currentChatTime = Date.now()
        if (currentChatTime - lastChatTime < config.msgCooldown * 1000) {
            const waitTime = (config.msgCooldown * 1000 - (currentChatTime - lastChatTime)) / 1000

            logger.debug(`[冷却中:${waitTime}s] ${session.username}(${session.userId}): ${session.content}`)

            context.message = `不要发这么快喵，等${waitTime}s后我们再聊天喵`

            return ChainMiddlewareRunStatus.STOP
        }
        lastChatTime = currentChatTime
        return ChainMiddlewareRunStatus.CONTINUE
    }).after("allow_reply")
}

declare module '../chains/chain' {
    interface ChainMiddlewareName {
        "cooldown_time": never
    }
}