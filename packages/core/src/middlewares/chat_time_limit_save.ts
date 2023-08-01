import { Awaitable, Computed, Context, h } from 'koishi';
import { Config } from '../config';

import { ChainMiddlewareContext, ChainMiddlewareRunStatus, ChatChain } from '../chains/chain';
import { Cache } from '../cache';
import { Factory } from '../llm-core/chat/factory';
import { createLogger } from '../llm-core/utils/logger';

const logger = createLogger("@dingyi222666/chathub/middlewares/chat_time_limit_save")



export function apply(ctx: Context, config: Config, chain: ChatChain) {

    chain.middleware("chat_time_limit_save", async (session, context) => {

        const { chatLimit, chatLimitCache, room: { conversationId }} = context.options

        let key = conversationId + "-" + session.userId

        chatLimit.count++

        // 先保存一次
        await chatLimitCache.set(key, chatLimit)

        return ChainMiddlewareRunStatus.CONTINUE
    }).after("render_message")

    //  .before("lifecycle-request_model")
}

declare module '../chains/chain' {
    interface ChainMiddlewareName {
        "chat_time_limit_save": never
    }


}

