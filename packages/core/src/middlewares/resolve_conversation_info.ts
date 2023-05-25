import { Context, h } from 'koishi';
import { Config } from '../config';
import { ChainMiddlewareContext, ChainMiddlewareRunStatus, ChatChain } from '../chain';
import { ConversationInfo } from '../types';
import { v4 as uuidv4 } from 'uuid';
import { getKeysCache } from '..';

export function apply(ctx: Context, config: Config, chain: ChatChain) {
    chain.middleware("resolve_conversation_info", async (session, context) => {

        const conversationInfoList = (await ctx.database.get("chathub_conversation_info", {
            senderId: context.options.senderInfo?.senderId,
            chatMode: context.options?.chatMode ?? (config.chatMode as ChatMode),
            model: { $regex: context.options?.model ?? await getKeysCache().get("defaultModel") ?? "" }
        }))

        let conversationInfo: ConversationInfo

        if (conversationInfoList.length == 0) {
            conversationInfo = await createConversationInfo(ctx, config, context)
        } else if (conversationInfoList.length == 1) {
            conversationInfo = conversationInfoList[0]
        } else {
            session.send(`基于你输入的模型的匹配结果，出现了多个会话，请输入更精确的模型名称`)

            return ChainMiddlewareRunStatus.STOP
        }

        context.options.conversationInfo = conversationInfo

        return conversationInfo != null ? ChainMiddlewareRunStatus.CONTINUE : ChainMiddlewareRunStatus.STOP
    }).after("sender_info")
    //  .before("lifecycle-request_model")
}

async function createConversationInfo(ctx: Context, config: Config, middlewareContext: ChainMiddlewareContext) {
    const conversationId = uuidv4()

    const conversationInfo: ConversationInfo = {
        conversationId,
        senderId: middlewareContext.options.senderInfo?.senderId,
        chatMode: middlewareContext.options?.chatMode ?? (config.chatMode as ChatMode),
        model: middlewareContext.options?.model
    }

    await ctx.database.create("chathub_conversation_info", conversationInfo)

    return conversationInfo
}


export type ChatMode = "search-chat" | "chat" | "search" | "tools";

declare module '../chain' {
    interface ChainMiddlewareContextOptions {
        conversationInfo?: ConversationInfo
        chatMode?: ChatMode
        model?: string
    }

    interface ChainMiddlewareName {
        "resolve_conversation_info": never
    }
}