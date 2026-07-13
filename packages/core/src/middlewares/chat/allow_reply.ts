/* eslint-disable operator-linebreak */
import { randomUUID } from 'crypto'
import { Context, h } from 'koishi'
import { Config } from '../../config'
import { ChainMiddlewareRunStatus, ChatChain } from '../../chains/chain'
import { parsePresetLaneInput } from '../../utils/message_content'

export function apply(ctx: Context, config: Config, chain: ChatChain) {
    chain
        .middleware('allow_reply', async (session, context) => {
            if (context.options.invocation != null) {
                context.options.reply_status = true
                return ChainMiddlewareRunStatus.CONTINUE
            }

            // 禁止套娃
            if (ctx.bots[session.uid]) return ChainMiddlewareRunStatus.STOP

            context.options.reply_status = false

            // 黑名单检查
            if ((await session.resolve(config.blackList)) === 1) {
                context.message = session.text('chatluna.block_message')
                return ChainMiddlewareRunStatus.STOP
            }

            // Observation is independent of private-reply and sender-reply gates.
            ctx.emit('chatluna/message-observed', {
                id: session.messageId ?? randomUUID(),
                at: new Date(session.timestamp),
                session,
                platform: session.platform,
                selfId: session.selfId,
                userId: session.userId,
                username: session.username,
                guildId: session.guildId,
                channelId: session.channelId,
                isDirect: session.isDirect,
                content: session.content,
                elements: session.elements
            })

            if (session.isDirect && !config.allowPrivate) {
                return ChainMiddlewareRunStatus.STOP
            }

            const notReply = await ctx.serial(
                'chatluna/before-check-sender',
                session
            )
            if (notReply) return ChainMiddlewareRunStatus.STOP

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
                return checkReplyPermission()
            }

            const botId = session.bot.userId

            // 艾特检查
            if (config.allowAtReply) {
                // See https://github.com/ChatLunaLab/chatluna/issues/477
                // Use atSelf instead of appel
                let appel = session.stripped.atSelf

                if (appel) {
                    return checkReplyPermission()
                }

                // 从消息元素中检测是否有被艾特当前用户

                appel =
                    session.elements?.some(
                        (element) =>
                            element.type === 'at' &&
                            element.attrs?.['id'] === botId
                    ) ?? false

                if (appel) {
                    return checkReplyPermission()
                }
            }

            // 引用检查
            // 检测回复的消息是否为 bot 本身

            if (config.allowQuoteReply && session.quote?.user?.id === botId) {
                return checkReplyPermission()
            }

            // bot名字检查
            if (
                (config.isNickname &&
                    config.botNames.some((name) => content.startsWith(name))) ||
                (config.isNickNameWithContent &&
                    config.botNames.some((name) => content.includes(name)))
            ) {
                return checkReplyPermission()
            }

            // 随机回复检查
            if (
                Math.random() <
                (await session.resolve(config.randomReplyFrequency))
            ) {
                return checkReplyPermission()
            }

            // 命令检查
            if (context.command != null) {
                return ChainMiddlewareRunStatus.CONTINUE
            }

            // 会话标题前缀匹配检查
            if (
                parsePresetLaneInput(
                    content,
                    ctx.chatluna.preset.getKeywordTriggerAliases().value
                ) != null
            ) {
                return ChainMiddlewareRunStatus.CONTINUE
            }

            return ChainMiddlewareRunStatus.STOP

            function checkReplyPermission() {
                context.options.reply_status = true
                return ChainMiddlewareRunStatus.CONTINUE
            }
        })
        .before('lifecycle-check')
}

declare module '../../chains/chain' {
    interface ChainMiddlewareName {
        allow_reply: never
    }

    interface ChainMiddlewareContextOptions {
        reply_status?: boolean
    }
}
