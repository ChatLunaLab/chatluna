import { Context, Session } from 'koishi'
import { parseRawModelName } from 'koishi-plugin-chatluna/llm-core/utils/count_tokens'
import { Cache } from '../../cache'
import {
    ChainMiddlewareContext,
    ChainMiddlewareRunStatus,
    ChatChain
} from '../../chains/chain'
import { createHash } from 'crypto'
import { Config } from '../../config'
import { ModelType } from 'koishi-plugin-chatluna/llm-core/platform/types'
import { logger } from 'koishi-plugin-chatluna'

export function apply(ctx: Context, config: Config, chain: ChatChain) {
    const chatLimitCache = new Cache(ctx, config, 'chatluna/chat_limit')

    chain
        .middleware('chat_time_limit_check', async (session, context) => {
            return await oldChatLimitCheck(session, context)
        })
        .after('resolve_model')
        .before('lifecycle-request_conversation')

    async function oldChatLimitCheck(
        session: Session,
        context: ChainMiddlewareContext
    ) {
        const target = await resolveConversationTarget(session, context)

        if (target == null) {
            return ChainMiddlewareRunStatus.CONTINUE
        }

        const { model, conversationId } = target

        // 为什么会是无

        if (
            (config.defaultModel === '无' ||
                config.defaultModel.trim().length < 1) &&
            ctx.chatluna.platform.listAllModels(ModelType.all).value.length < 1
        ) {
            return session.text('chatluna.not_available_model')
        }

        let platformClient: string

        try {
            ;[platformClient] = parseRawModelName(model)
        } catch (e) {
            logger.error(e)
            return session.text('chatluna.not_available_model')
        }

        const client = await ctx.chatluna.platform.getClient(platformClient)

        if (!client.value) {
            logger.error(`Can't find model adapter for ${model}`)
            return session.text('chatluna.not_available_model')
        }

        const clientConfig = client.value.configPool.getConfig(true)

        if (!clientConfig) {
            logger.error(`Can't find model adapter for ${model}`)
            return session.text('chatluna.not_available_model')
        }

        const chatLimitRaw = clientConfig.value.chatLimit

        const chatLimitComputed = await session.resolve(chatLimitRaw)

        let key = conversationId + '-' + session.userId

        // md5

        key = createHash('md5').update(key).digest('hex')

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

                    context.message = session.text(
                        'chatluna.chat_limit_exceeded',
                        [time]
                    )

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
    }

    async function resolveConversationTarget(
        session: Session,
        context: ChainMiddlewareContext
    ) {
        const conversationId = context.options.conversationId

        if (conversationId == null) {
            return null
        }

        const resolved = await ctx.chatluna.conversation.resolveContext(
            session,
            {
                conversationId
            }
        )

        if (resolved.conversation == null) {
            return null
        }

        return {
            model: resolved.effectiveModel ?? resolved.conversation.model,
            conversationId: resolved.conversation.id
        }
    }
}

declare module '../../chains/chain' {
    interface ChainMiddlewareName {
        chat_time_limit_check: never
    }

    interface ChainMiddlewareContextOptions {
        chatLimitCache?: Cache<'chatluna/chat_limit', ChatLimit>
        chatLimit?: ChatLimit
    }
}

declare module '@koishijs/cache' {
    interface Tables {
        'chatluna/chat_limit': ChatLimit
    }
}

export interface ChatLimit {
    time: number
    count: number
}
