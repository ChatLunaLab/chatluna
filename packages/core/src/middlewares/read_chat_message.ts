import { Context, h } from 'koishi';
import { Config } from '../config';
import { ChainMiddlewareRunStatus, ChatChain } from '../chain';
import { createLogger } from '../llm-core/utils/logger';

const logger = createLogger("@dingyi222666/chathub/middlewares/read_chat_message")

export function apply(ctx: Context, config: Config, chain: ChatChain) {
    chain.middleware("read_chat_message", async (session, context) => {

        let message = context.command != null ? context.message : session.elements

        if (context.options.message != null || message instanceof String) {
            return ChainMiddlewareRunStatus.SKIPPED
        }

        message = message as h[] | string

        if (typeof message === "string") {
            return message
        }

        const result: string[] = []

        for (const element of message) {
            if (element.type === 'text') {
                result.push(element.attrs["content"])
            } else if (element.type === 'at') {
                const name = element.attrs["name"]
                if (name) {
                    result.push(`@${name}`)
                }
            }
        }

        return result.join("")

    }).after("lifecycle-prepare")

}

declare module '../chain' {
    export interface ChainMiddlewareName {
        "read_chat_message": string
    }
}