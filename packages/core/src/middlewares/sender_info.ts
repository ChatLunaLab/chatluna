import { Context, h } from 'koishi';
import { Config } from '../config';
import { ChainMiddlewareRunStatus, ChatChain } from '../chain';
import { SenderInfo } from '../types';

export function apply(ctx: Context, config: Config, chain: ChatChain) {
    chain.middleware("sender_info", async (session, context) => {

        let senderId = session.subtype === 'group' ? session.guildId : session.userId
        let senderName = session.subtype === 'group' ? (session.guildName ?? session.username) : session.username

        //检测是否为群聊，是否在隔离名单里面
        if (session.guildId && config.conversationIsolationGroup.includes(session.guildId)) {
            // 应用为自己发的id
            senderId = session.userId
            senderName = session.username
        }

        const senderInfo: SenderInfo = {
            senderId: senderId,
            senderName: senderName,
            userId: session.userId,
        }

        context.options.senderInfo = senderInfo

        await ctx.database.upsert("chathub_sender_info", [senderInfo])

        context.options.senderInfo.preset = (await ctx.database.get("chathub_sender_info", { senderId: senderInfo.senderId, userId: senderInfo.userId }, ['preset']))[0].preset

        return ChainMiddlewareRunStatus.CONTINUE
    }).after("lifecycle-prepare")
}

declare module '../chain' {
    interface ChainMiddlewareContextOptions {
        senderInfo?: SenderInfo
    }

    interface ChainMiddlewareName {
        sender_info: never
    }
}