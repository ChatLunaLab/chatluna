import { Context } from 'koishi';
import { Config } from '../config';
import { ChainMiddlewareRunStatus, ChatChain } from '../chain';
import { createLogger } from '../llm-core/utils/logger';
import { Factory } from '../llm-core/chat/factory';
import { preset } from './resolve_preset';
import { ChatInterface } from '../llm-core/chat/app';

const logger = createLogger("@dingyi222666/chathub/middlewares/reset_converstaion")


export function apply(ctx: Context, config: Config, chain: ChatChain) {
    chain.middleware("reset_converstaion", async (session, context) => {

        const { command, options } = context

        if (command !== "reset" && options.reset?.trigger !== true) return ChainMiddlewareRunStatus.SKIPPED

        const chatInterface = await ctx.chathub.queryBridger(context.options.conversationInfo)

        await chatInterface.clearChatHistory(context.options.conversationInfo)

        await ctx.chathub.clearInterface(context.options.conversationInfo)

        if (options.reset?.sendMessage !== false) {
            context.message = "重置会话了喵"
        }

        return ChainMiddlewareRunStatus.STOP
    }).after("lifecycle-handle_command")
}

declare module '../chain' {
    interface ChainMiddlewareName {
        "reset_converstaion": never
    }

    interface ChainMiddlewareContextOptions {
        reset?: {
            trigger?: boolean,
            sendMessage?: boolean
        }
    }
}