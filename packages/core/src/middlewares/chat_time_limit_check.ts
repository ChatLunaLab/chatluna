import { Context } from 'koishi'
import { Config } from '../config'
import { ChainMiddlewareRunStatus, ChatChain } from '../chains/chain'
import { Cache } from '../cache'
import { parseRawModelName } from '../llm-core/utils/count_tokens'
import { ChatHubError, ChatHubErrorCode } from '../utils/error'

export function apply(ctx: Context, config: Config, chain: ChatChain) {
    const chatLimitCache = new Cache(ctx, config, 'chathub/chat_limit')
    const service = ctx.chathub.platform

    chain
        .middleware('chat_time_limit_check', async (session, context) => {
            const {
                room: { model, conversationId }
            } = context.options

            const config = service.getConfigs(parseRawModelName(model)[0])?.[0]

            if (!config) {
                throw new ChatHubError(
                    ChatHubErrorCode.MODEL_ADAPTER_NOT_FOUND,
                    new Error(`Can't find model adapter for ${model}`)
                )
            }

            const chatLimitRaw = config.value.chatLimit

            const chatLimitComputed = await session.resolve(chatLimitRaw)

            const key = conversationId + '-' + session.userId

            let chatLimitOnDataBase = await chatLimitCache.get(key)

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
                        const time = Math.ceil(
                            (1000 * 60 * 60 -
                                (Date.now() - chatLimitOnDataBase.time)) /
                                1000 /
                                60
                        )

                        context.message = `你的聊天次数已经用完了喵，还需要等待 ${time} 分钟才能继续聊天喵 >_<`

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
            await chatLimitCache.set(key, chatLimitOnDataBase)

            context.options.chatLimit = chatLimitOnDataBase
            context.options.chatLimitCache = chatLimitCache

            return ChainMiddlewareRunStatus.CONTINUE
        })
        .after('resolve_model')
        .before('request_model')
}

declare module '../chains/chain' {
    interface ChainMiddlewareName {
        chat_time_limit_check: never
    }

    interface ChainMiddlewareContextOptions {
        chatLimitCache?: Cache<'chathub/chat_limit', ChatLimit>
        chatLimit?: ChatLimit
    }
}

declare module '@koishijs/cache' {
    interface Tables {
        'chathub/chat_limit': ChatLimit
    }
}

export interface ChatLimit {
    time: number
    count: number
}
