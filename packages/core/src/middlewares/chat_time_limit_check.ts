import { Awaitable, Computed, Context, h } from 'koishi';
import { Config } from '../config';

import { ChainMiddlewareContext, ChainMiddlewareRunStatus, ChatChain } from '../chain';
import { Cache } from '../cache';
import { Factory } from '@dingyi222666/chathub-llm-core/lib/chat/factory';
import { createLogger } from '@dingyi222666/chathub-llm-core/lib/utils/logger';

const logger = createLogger("@dingyi222666/chathub/middlewares/chat_time_limit_check")

let chatLimitCache: Cache<"chathub/chat_limit", ChatLimit> = null

export function apply(ctx: Context, config: Config, chain: ChatChain) {

    chatLimitCache = new Cache(ctx, config, "chathub/chat_limit")

    chain.middleware("chat_time_limit_check", async (session, context) => {

        const { conversationInfo: { conversationId, model }, senderInfo: { userId } } = context.options

        const chatLimitRaw = (await resolveModelProvider(model)).getExtraInfo().chatTimeLimit as Computed<Awaitable<number>>

        const chatLimitComputed = await session.resolve(chatLimitRaw)

        logger.debug(`[chat_time_limit] chatLimitComputed: ${chatLimitComputed}`)

        let chatLimitOnDataBase = await chatLimitCache.get(conversationId + "-" + userId)

        if (chatLimitOnDataBase) {
            // 如果大于1小时的间隔，就重置
            if (Date.now() - chatLimitOnDataBase.time > 1000 * 60 * 60) {
                chatLimitOnDataBase = {
                    time: Date.now(),
                    count: 0
                }
            } else {
                // 用满了
                if (chatLimitOnDataBase.count >= chatLimitComputed) {
                    const time = Math.ceil((1000 * 60 * 60 - (Date.now() - chatLimitOnDataBase.time)) / 1000 / 60)

                    context.message = `你的聊天次数已经用完了喵，还需要等待${time}分钟才能继续聊天喵 >_<`

                    return ChainMiddlewareRunStatus.STOP
                } else {
                    chatLimitOnDataBase.count++
                }
            }
        } else {
            chatLimitOnDataBase = {
                time: Date.now(),
                count: 0
            }
        }

        // 先保存一次
        await chatLimitCache.set(conversationId + "-" + userId, chatLimitOnDataBase)

        context.options.chatLimit = chatLimitOnDataBase
        context.options.chatLimitCache = chatLimitCache

        return ChainMiddlewareRunStatus.CONTINUE
    }).after("resolve_model")
        .before("request_model")
    //  .before("lifecycle-request_model")
}

async function resolveModelProvider(model: string) {
    const splited = model.split("/")
    return (await Factory.selectModelProviders(async (name, provider) => {
        return name == splited[0] && (await provider.listModels()).includes(splited[1])
    }))[0]
}

declare module '../chain' {
    interface ChainMiddlewareName {
        "chat_time_limit_check": never
    }

    interface ChainMiddlewareContextOptions {
        chatLimitCache?: Cache<"chathub/chat_limit", ChatLimit>,
        chatLimit?: ChatLimit
    }
}

declare module '@koishijs/cache' {
    interface Tables {
        'chathub/chat_limit': ChatLimit
    }
}

export interface ChatLimit {
    time: number,
    count: number
}