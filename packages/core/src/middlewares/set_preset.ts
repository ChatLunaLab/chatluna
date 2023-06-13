import { Context } from 'koishi';
import { Config } from '../config';
import { ChainMiddlewareRunStatus, ChatChain } from '../chain';
import { createLogger } from '../llm-core/utils/logger';
import { Factory } from '../llm-core/chat/factory';
import { preset } from './resolve_preset';

const logger = createLogger("@dingyi222666/chathub/middlewares/set_preset")

export function apply(ctx: Context, config: Config, chain: ChatChain) {
    chain.middleware("set_preset", async (session, context) => {

        const { command } = context

        if (command !== "setPreset") return ChainMiddlewareRunStatus.SKIPPED

        const conversationInfo = context.options.conversationInfo

        const presetName = context.options.setPreset

        const presetTemplate = await preset.getPreset(presetName)

        conversationInfo.systemPrompts = presetTemplate.rawText

        await ctx.database.upsert("chathub_conversation_info", [conversationInfo])

        if (context.options.chatMode == null && context.options.setModel == null) {
            // 如果没有指定聊天模式和模型，那么也同时设置默认的聊天模式和模型

            preset.setDefaultPreset(presetTemplate.triggerKeyword[0])
        }

        context.message = `已切换会话预设为 ${presetTemplate.triggerKeyword[0]}, 快来和我聊天吧`

        return ChainMiddlewareRunStatus.CONTINUE
    }).before("reset_converstaion")
}

declare module '../chain' {
    interface ChainMiddlewareName {
        "set_preset": never
    }

    interface ChainMiddlewareContextOptions {
        setPreset?: string
    }
}