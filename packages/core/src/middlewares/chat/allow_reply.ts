/* eslint-disable operator-linebreak */
import { Context, h } from 'koishi'
import { Config } from '../../config'
import { ChainMiddlewareRunStatus, ChatChain } from '../../chains/chain'
import { queryJoinedConversationRoom } from '../../chains/rooms'

export function apply(ctx: Context, config: Config, chain: ChatChain) {
    chain
        .middleware('allow_reply', async (session, context) => {
            // 禁止套娃
            if (ctx.bots[session.uid]) return ChainMiddlewareRunStatus.STOP

            context.options.replyStatus = false

            if (context.options.force_reply) {
                context.options.replyStatus = true
                return ChainMiddlewareRunStatus.CONTINUE
            }

            const content = h
                .select(session.elements, 'text')
                .join('')
                .trimStart()
            // 私聊检查
            if (
                session.isDirect &&
                config.allowPrivate &&
                (context.command != null || config.privateChatWithoutCommand)
            ) {
                return await checkReplyPermission()
            }

            const botId = session.bot.userId

            // 艾特检查
            if (config.allowAtReply) {
                // See https://github.com/ChatLunaLab/chatluna/issues/477
                // Use atSelf instead of appel
                let appel = session.stripped.atSelf

                if (appel) {
                    return await checkReplyPermission()
                }

                // 从消息元素中检测是否有被艾特当前用户

                appel =
                    session.elements?.some(
                        (element) =>
                            element.type === 'at' &&
                            element.attrs?.['id'] === botId
                    ) ?? false

                if (appel) {
                    return await checkReplyPermission()
                }
            }

            // 引用检查
            // 检测回复的消息是否为 bot 本身

            if (config.allowQuoteReply && session.quote?.user?.id === botId) {
                return await checkReplyPermission()
            }

            // bot名字检查
            if (
                (config.isNickname &&
                    config.botNames.some((name) => content.startsWith(name))) ||
                (config.isNickNameWithContent &&
                    config.botNames.some((name) => content.includes(name)))
            ) {
                return await checkReplyPermission()
            }

            // 随机回复检查
            if (
                Math.random() <
                (await session.resolve(config.randomReplyFrequency))
            ) {
                return await checkReplyPermission()
            }

            // 命令检查
            if (context.command != null) {
                return ChainMiddlewareRunStatus.CONTINUE
            }

            // 房间名称匹配检查
            if (config.allowChatWithRoomName) {
                context.options.replyStatus = true
                return ChainMiddlewareRunStatus.CONTINUE
            }

            if (
                config.queueAtMessages &&
                config.includeQueuedMessagesInContext
            ) {
                const wrapper = ctx.chatluna.getCachedInterfaceWrapper()
                if (wrapper?.hasReplyingConversations()) {
                    const room = await queryJoinedConversationRoom(ctx, session)
                    const conversationId = room?.conversationId
                    if (conversationId && wrapper.isReplying(conversationId)) {
                        return ChainMiddlewareRunStatus.CONTINUE
                    }
                }
            }

            return ChainMiddlewareRunStatus.STOP

            // 辅助函数：检查回复权限
            async function checkReplyPermission() {
                const notReply = await ctx.serial(
                    'chatluna/before-check-sender',
                    session
                )
                const status = notReply
                    ? ChainMiddlewareRunStatus.STOP
                    : ChainMiddlewareRunStatus.CONTINUE
                context.options.replyStatus =
                    status === ChainMiddlewareRunStatus.CONTINUE
                return status
            }
        })
        .before('lifecycle-check')
}

declare module '../../chains/chain' {
    interface ChainMiddlewareName {
        allow_reply: never
    }

    interface ChainMiddlewareContextOptions {
        force_reply?: boolean
        replyStatus?: boolean
    }
}
