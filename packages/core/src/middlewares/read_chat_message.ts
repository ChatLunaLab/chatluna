import { Context, h } from 'koishi';
import { Config } from '../config';
import { ChainMiddlewareRunStatus, ChatChain } from '../chains/chain';
import { createLogger } from '../utils/logger';

const logger = createLogger()

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
            } else if (element.type === 'at' && element.attrs['id'] !== session.bot.selfId) {
                const name = element.attrs["name"]
                if (name) {
                    result.push(`@${name}`)
                }
            } else if (element.type === "image") {
                // TODO: 图片读取，多模态
                return ChainMiddlewareRunStatus.STOP
            }
        }

        return result.join("")

    }).after("lifecycle-prepare")

}

declare module '../chains/chain' {
    export interface ChainMiddlewareName {
        "read_chat_message": string
    }
}