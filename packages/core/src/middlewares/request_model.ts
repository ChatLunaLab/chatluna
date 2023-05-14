import { Context } from 'koishi';
import { Config } from '../config';
import { ChatChain } from '../chain';
import { createLogger } from '@dingyi222666/chathub-llm-core/lib/utils/logger';
import { Message } from '../types';

const logger = createLogger("@dingyi222666/chathub-llm-core/middlewares/request_model")


export function apply(ctx: Context, config: Config, chain: ChatChain) {
    chain.middleware("request_model", async (session, context) => {

        const conversationInfo = context.options.conversationInfo


        if (conversationInfo.model == null) {
            throw new Error("Can't find model")
        }

        context.options.resopnseMessage = ctx.chathub.chat(
            conversationInfo,
            {
                name: session.username,
                text: context.message as string
            })

        return true
    }).after("lifecycle-request_model")
}

declare module '../chain' {
    interface ChainMiddlewareName {
        "request_model": never
    }

    interface ChainMiddlewareOptions {
        responseMessage: Message
    }
}