import { Context, h } from 'koishi';
import { Config } from '../config';
import { ChainMiddlewareContext, ChainMiddlewareRunStatus, ChatChain } from '../chain';
import { ConversationInfo } from '../types';
import { v4 as uuidv4 } from 'uuid';

export function apply(ctx: Context, config: Config, chain: ChatChain) {
    chain.middleware("resolve_conversation_info", async (session, context) => {

        const conversationInfo = (await ctx.database.get("chathub_conversation_info", {
            senderId: context.options.senderInfo?.senderId,
            chatMode: context.options?.chatMode ?? (config.chatMode as ChatMode)
        }))?.[0] ?? (await createConversationInfo(ctx, config, context))

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