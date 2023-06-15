import { Context, h } from 'koishi';
import { Config } from '../config';
import { ChainMiddlewareContext, ChainMiddlewareRunStatus, ChatChain } from '../chain';
import { ConversationInfo } from '../types';
import { v4 as uuidv4 } from 'uuid';
import { getKeysCache } from '..';
import { Preset } from '../preset';

export let preset: Preset

export function apply(ctx: Context, config: Config, chain: ChatChain) {

    preset = new Preset(ctx, config, getKeysCache())

    chain.middleware("resolve_preset", async (session, context) => {

        const { conversationInfo,senderInfo } = context.options
        if (conversationInfo.systemPrompts != null || conversationInfo.model == null) {
            return ChainMiddlewareRunStatus.SKIPPED
        }

        const template = await preset.getDefaultPreset()

        conversationInfo.systemPrompts = template.rawText
        conversationInfo.preset = template.triggerKeyword[0]

        await ctx.database.upsert("chathub_conversation_info", [conversationInfo])

        senderInfo.preset = template.triggerKeyword[0]

        await ctx.database.upsert("chathub_sender_info", [senderInfo])

        return ChainMiddlewareRunStatus.CONTINUE
    }).after("resolve_conversation_info")
    //  .before("lifecycle-request_model")


}

declare module '../chain' {
    interface ChainMiddlewareName {
        "resolve_preset": never
    }
}


