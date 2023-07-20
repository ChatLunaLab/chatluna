import { Awaitable, Computed, Context, h } from 'koishi';
import { Config } from '../config';

import { ChainMiddlewareContext, ChainMiddlewareRunStatus, ChatChain } from '../chains/chain';
import { Cache } from '../cache';
import { Factory } from '../llm-core/chat/factory';
import { createLogger } from '../llm-core/utils/logger';

const logger = createLogger("@dingyi222666/chathub/middlewares/chat_time_limit_save")



export function apply(ctx: Context, config: Config, chain: ChatChain) {

    chain.middleware("chat_time_limit_save", async (session, context) => {

        const { chatLimit, chatLimitCache, conversationInfo: { conversationId }, senderInfo: { userId } } = context.options

        chatLimit.count++

        // 先保存一次
        await chatLimitCache.set(conversationId + "-" + userId, chatLimit)

        return ChainMiddlewareRunStatus.CONTINUE
    }).after("render_message")

    //  .before("lifecycle-request_model")
}

async function resolveModelProvider(model: string) {
    const splited = model.split(/(?<=^[^\/]+)\//)
    return (await Factory.selectModelProviders(async (name, provider) => {
        return name == splited[0] && (await provider.listModels()).includes(splited[1])
    }))[0]
}

declare module '../chains/chain' {
    interface ChainMiddlewareName {
        "chat_time_limit_save": never
    }


}

