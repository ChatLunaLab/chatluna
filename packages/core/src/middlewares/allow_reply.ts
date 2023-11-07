/* eslint-disable operator-linebreak */
import { Context } from 'koishi'
import { Config } from '../config'
import { ChainMiddlewareRunStatus, ChatChain } from '../chains/chain'

export function apply(ctx: Context, config: Config, chain: ChatChain) {
    chain
        .middleware('allow_reply', async (session, context) => {
            // 禁止套娃
            if (ctx.bots[session.uid]) return ChainMiddlewareRunStatus.STOP

            const result =
                // 私聊
                session.isDirect &&
                config.allowPrivate &&
                (context.command != null || config.privateChatWithoutCommand)
                    ? true
                    : // 群艾特
                    session.stripped.appel && config.allowAtReply
                    ? true
                    : // bot名字
                    session.content.startsWith(config.botName) &&
                      config.isNickname
                    ? true
                    : // 随机回复
                    Math.random() < config.randomReplyFrequency
                    ? true
                    : // 命令
                      context.command != null

            if (result) {
                const notReply = await ctx.serial(
                    'chatluna/before-check-sender',
                    session
                )

                return notReply
                    ? ChainMiddlewareRunStatus.STOP
                    : ChainMiddlewareRunStatus.CONTINUE
            } else {
                return ChainMiddlewareRunStatus.STOP
            }
        })
        .after('lifecycle-check')
}

declare module '../chains/chain' {
    interface ChainMiddlewareName {
        allow_reply: never
    }
}
