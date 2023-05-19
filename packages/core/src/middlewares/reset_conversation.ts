import { Context } from 'koishi';
import { Config } from '../config';
import { ChainMiddlewareRunStatus, ChatChain } from '../chain';
import { createLogger } from '@dingyi222666/chathub-llm-core/lib/utils/logger';
import { Factory } from '@dingyi222666/chathub-llm-core/lib/chat/factory';
import { preset } from './resolve_preset';
import { ChatInterface } from '@dingyi222666/chathub-llm-core/lib/chat/app';

const logger = createLogger("@dingyi222666/chathub/middlewares/reset_converstaion")


export function apply(ctx: Context, config: Config, chain: ChatChain) {
    chain.middleware("reset_converstaion", async (session, context) => {

        const { command, options } = context

        if (command !== "reset" && options.reset?.trigger !== true) return ChainMiddlewareRunStatus.SKIPPED

        const chatInterface = await ctx.chathub.query(context.options.conversationInfo)

        await chatInterface.clearChatHistory()

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