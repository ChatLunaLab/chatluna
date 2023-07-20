import { Context } from 'koishi';
import { Config } from '../config';
import { ChainMiddlewareRunStatus, ChatChain } from '../chains/chain';
import { createLogger } from '../llm-core/utils/logger';
import { Message } from '../types';
import { formatPresetTemplateString, loadPreset } from '../llm-core/prompt'
const logger = createLogger("@dingyi222666/chathub/middlewares/request_model")


export function apply(ctx: Context, config: Config, chain: ChatChain) {
    chain.middleware("request_model", async (session, context) => {

        const conversationInfo = context.options.conversationInfo

        if (conversationInfo.model == null) {
            throw new Error("Can't find model")
        }

        const presetTemplate = loadPreset(context.options.conversationInfo.systemPrompts)

        if (presetTemplate.formatUserPromptString != null) {
            context.message = formatPresetTemplateString(presetTemplate.formatUserPromptString, {
                sender: session.username,
                prompt: context.message as string,
                date: new Date().toLocaleString(),
            })
        }

        context.options.responseMessage = await ctx.chathub.chat(
            conversationInfo,
            {
                name: session.username,
                content: context.message as string
            })

        logger.debug(`[request_model] responseMessage: ${context.options.responseMessage.content}`)

        return ChainMiddlewareRunStatus.CONTINUE
    }).after("lifecycle-request_model")
}

declare module '../chains/chain' {
    interface ChainMiddlewareName {
        "request_model": never
    }

    interface ChainMiddlewareContextOptions {
        responseMessage?: Message
    }
}