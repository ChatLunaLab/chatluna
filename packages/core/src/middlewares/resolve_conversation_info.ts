import { Context, h, Query } from 'koishi';
import { Config } from '../config';
import { ChainMiddlewareContext, ChainMiddlewareRunStatus, ChatChain } from '../chain';
import { ConversationInfo, SenderInfo } from '../types';
import { v4 as uuidv4 } from 'uuid';
import { getKeysCache } from '..';
import { createLogger } from '../llm-core/utils/logger';
import { preset } from './resolve_preset';

const logger = createLogger("@dingyi222666/chathub/middlewares/resolve_conversation_info")

export function apply(ctx: Context, config: Config, chain: ChatChain) {
    chain.middleware("resolve_conversation_info", async (session, context) => {

        context.options.senderInfo = await resolveSenderInfo(context.options?.senderInfo, ctx)

        let modelName = context.options?.setModel ??
            context.options.senderInfo.model ?? await getKeysCache().get("default-model")

        let presetName = context.options.senderInfo.preset ?? await getKeysCache().get("default-preset")

        let query: Query<ConversationInfo> = {
            senderId: context.options.senderInfo?.senderId,
            chatMode: context.options?.chatMode ?? (config.chatMode as ChatMode),
            // use '' to query all
            model: { $regex: modelName },
            preset: { $regex: presetName }
        }

        if ((query.model as Query.FieldExpr<string>).$regex == null) {
            delete query.model
        }

        if ((query.preset as Query.FieldExpr<string>).$regex == null) {
            delete query.preset
        }

        if (context.options?.converstaionId) {
            query = {
                conversationId: context.options.converstaionId
            }
        }

        const conversationInfoList = (await ctx.database.get("chathub_conversation_info", query)).filter(x => {
            return x.model === modelName && (presetName && x.preset === presetName) 
        })

        let conversationInfo: ConversationInfo

        if (conversationInfoList.length == 0) {
            if (modelName == null) {
                // create the fake conversationInfo
                conversationInfo = {
                    conversationId: uuidv4(),
                    senderId: context.options.senderInfo?.senderId,
                    chatMode: context.options?.chatMode ?? (config.chatMode as ChatMode),
                    model: undefined
                }
            } else {
                conversationInfo = await createConversationInfo(ctx, config, context, modelName)
            }
        } else if (conversationInfoList.length == 1) {
            conversationInfo = conversationInfoList[0]
        } else {
            await session.send(`基于你输入的模型的匹配结果，出现了多个会话，请输入更精确的模型名称`)

            logger.debug(`[resolve_conversation_info] conversationInfoList.length > 1, conversationInfoList: ${JSON.stringify(conversationInfoList)}`)

            return ChainMiddlewareRunStatus.STOP
        }

        context.options.conversationInfo = conversationInfo

        return conversationInfo != null ? ChainMiddlewareRunStatus.CONTINUE : ChainMiddlewareRunStatus.STOP
    }).after("sender_info")
    //  .before("lifecycle-request_model")
}

async function createConversationInfo(ctx: Context, config: Config, middlewareContext: ChainMiddlewareContext, modelName: string) {
    const conversationId = uuidv4()

    const conversationInfo: ConversationInfo = {
        conversationId,
        senderId: middlewareContext.options.senderInfo?.senderId,
        chatMode: middlewareContext.options?.chatMode ?? (config.chatMode as ChatMode),
        model: modelName
    }

    middlewareContext.options.senderInfo.model = modelName
   
    await ctx.database.create("chathub_conversation_info", conversationInfo)

    await ctx.database.upsert("chathub_sender_info", [middlewareContext.options.senderInfo])

    return conversationInfo
}

export async function resolveSenderInfo(senderInfo: SenderInfo, ctx: Context) {

    const resolved = await ctx.database.get("chathub_sender_info", { senderId: senderInfo.senderId })

    senderInfo.model = resolved[0]?.model

    senderInfo.preset = resolved[0]?.preset

    return senderInfo
}

export type ChatMode = "plugin" | "chat" | "browsing"

declare module '../chain' {
    interface ChainMiddlewareContextOptions {
        conversationInfo?: ConversationInfo
        chatMode?: ChatMode
        setModel?: string
    }

    interface ChainMiddlewareName {
        "resolve_conversation_info": never
    }
}