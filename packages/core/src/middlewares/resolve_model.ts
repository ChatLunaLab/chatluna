import { Context, h } from 'koishi';
import { Config } from '../config';
import { ChainMiddlewareContext, ChatChain } from '../chain';
import { ConversationInfo } from '../types';
import { v4 as uuidv4 } from 'uuid';
import { getKeysCache } from '..';
import { Preset } from '../preset';

export function apply(ctx: Context, config: Config, chain: ChatChain) {
    chain.middleware("resolve_model", async (session, context) => {

        const options = context.options

        const conversationInfo = options.conversationInfo
        if (conversationInfo.model != null) {
            return true
        }

        if (options.model != null) {
            conversationInfo.model = options.model
        } else {
            const defaultModel = await getKeysCache().get("defaultModel")

            if (defaultModel != null) {
                conversationInfo.model = defaultModel
            }
        }

        if (conversationInfo.model == null) {
            throw new Error("无法找到模型")
        }

        await ctx.database.upsert("chathub_conversation_info", [conversationInfo])

        return true
    }).before("request_model")
    //  .before("lifecycle-request_model")


}

declare module '../chain' {
    interface ChainMiddlewareName {
        "resolve_model": never
    }
}


