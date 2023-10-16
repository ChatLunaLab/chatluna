import { Context, Session } from 'koishi'
import { Config } from '../config'
import {
    ChainMiddlewareContext,
    ChainMiddlewareRunStatus,
    ChatChain
} from '../chains/chain'
import { Cache } from '../cache'
import { parseRawModelName } from '../llm-core/utils/count_tokens'
import { ChatHubError, ChatHubErrorCode } from '../utils/error'
import { ChatHubAuthGroup } from '../authorization/types'

export function apply(ctx: Context, config: Config, chain: ChatChain) {
    const chatLimitCache = new Cache(ctx, config, 'chathub/chat_limit')
    const platformService = ctx.chathub.platform
    const authService = ctx.chathub_auth

    chain
        .middleware('chat_time_limit_check', async (session, context) => {
            if (config.authSystem !== true) {
                return await oldChatLimitCheck(session, context)
            }

            const {
                room: { model }
            } = context.options

            // check account balance
            const authUser = await authService.getUser(session)

            if (authUser && context.command == null && authUser.balance <= 0) {
                context.message = `您当前的余额剩余 ${authUser.balance}，无法继续使用。请联系相关人员提升你的余额`
                return ChainMiddlewareRunStatus.STOP
            }

            let authGroup = await authService.resolveAuthGroup(
                session,
                parseRawModelName(model)[0]
            )

            console.log(authGroup)

            if (
                authGroup.supportModels != null &&
                authGroup.supportModels.find((m) => m === model) == null
            ) {
                context.message = `您当前所在的配额组不支持当前房间里使用的 ${model}，无法继续使用。请联系相关人员提升你的聊天权限`
                return ChainMiddlewareRunStatus.STOP
            }

            authGroup = await authService.resetAuthGroup(authGroup.id)

            context.options.authGroup = authGroup

            // check pre min

            if (
                (authGroup.currentLimitPerMin ?? 0) + 1 >
                authGroup.limitPerMin
            ) {
                context.message = `当前配额组 ${authGroup.name} 限制 ${authGroup.limitPerMin} 条消息/分钟。目前已使用了 ${authGroup.currentLimitPerMin} 条消息。请联系相关人员尝试提升当前配额组的额度。`

                return ChainMiddlewareRunStatus.STOP
            }

            if (
                (authGroup.currentLimitPerDay ?? 0) + 1 >
                authGroup.limitPerDay
            ) {
                context.message = `当前配额组 ${authGroup.name} 限制 ${authGroup.limitPerDay} 条消息/天。目前已使用了 ${authGroup.currentLimitPerDay} 条消息。请联系相关人员尝试提升当前配额组的额度。`

                return ChainMiddlewareRunStatus.STOP
            }

            return ChainMiddlewareRunStatus.CONTINUE
        })
        .after('resolve_model')
        .before('request_model')

    async function oldChatLimitCheck(
        session: Session,
        context: ChainMiddlewareContext
    ) {
        const {
            room: { model, conversationId }
        } = context.options

        const config = platformService.getConfigs(
            parseRawModelName(model)[0]
        )?.[0]

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
    }
}

declare module '../chains/chain' {
    interface ChainMiddlewareName {
        chat_time_limit_check: never
    }

    interface ChainMiddlewareContextOptions {
        chatLimitCache?: Cache<'chathub/chat_limit', ChatLimit>
        chatLimit?: ChatLimit
        authGroup?: ChatHubAuthGroup
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
