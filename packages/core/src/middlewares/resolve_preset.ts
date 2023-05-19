import { Context, h } from 'koishi';
import { Config } from '../config';
import { ChainMiddlewareContext, ChatChain } from '../chain';
import { ConversationInfo } from '../types';
import { v4 as uuidv4 } from 'uuid';
import { getKeysCache } from '..';
import { Preset } from '../preset';

export let preset: Preset

export function apply(ctx: Context, config: Config, chain: ChatChain) {

    preset = new Preset(ctx, config, getKeysCache())

    chain.middleware("resolve_preset", async (session, context) => {

        const conversationInfo = context.options.conversationInfo
        if (conversationInfo.systemPrompts != null) {
            return true
        }

        const template = await preset.getDefaultPreset()

        conversationInfo.systemPrompts = template.rawText
        await ctx.database.upsert("chathub_conversation_info", [conversationInfo])

        return true
    }).after("resolve_conversation_info")
    //  .before("lifecycle-request_model")


}

declare module '../chain' {
    interface ChainMiddlewareName {
        "resolve_preset": never
    }
}


