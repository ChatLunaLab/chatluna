import { Context } from 'koishi';
import { Config } from '../config';
import { ChatChain } from '../chain';
import { createLogger } from '@dingyi222666/chathub-llm-core/lib/utils/logger';
import { Factory } from '@dingyi222666/chathub-llm-core/lib/chat/factory';
import { preset } from './resolve_preset';

const logger = createLogger("@dingyi222666/chathub/middlewares/set_preset")

export function apply(ctx: Context, config: Config, chain: ChatChain) {
    chain.middleware("set_preset", async (session, context) => {

        const { command } = context

        if (command !== "setPreset") return true

        const conversationInfo = context.options.conversationInfo

        const presetName = context.options.setPreset

        const presetTemplate = await preset.getPreset(presetName)

        conversationInfo.systemPrompts = presetTemplate.rawText

        await ctx.database.upsert("chathub_conversation_info", [conversationInfo])

        context.message = `已切换会话预设为 ${presetTemplate.triggerKeyword[0]}, 快来和我聊天吧`

        return false
    }).after("reset_converstaion")
}

declare module '../chain' {
    interface ChainMiddlewareName {
        "set_preset": never
    }

    interface ChainMiddlewareContextOptions {
        setPreset?: string
    }
}