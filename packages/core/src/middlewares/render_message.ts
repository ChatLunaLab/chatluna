import { Context } from 'koishi';
import { Config } from '../config';
import { ChatChain } from '../chain';
import { createLogger } from '@dingyi222666/chathub-llm-core/lib/utils/logger';
import { Message } from '../types';
import { DefaultRenderer } from '../render';

const logger = createLogger("@dingyi222666/chathub/middlewares/render_message")

let renderer: DefaultRenderer

export function apply(ctx: Context, config: Config, chain: ChatChain) {

    renderer = new DefaultRenderer(ctx, config)

    chain.middleware("render_message", async (session, context) => {

        return (await renderer.render(context.options.responseMessage)).map((message) => {
            const elements = message.element
            if (elements instanceof Array) {
                return elements
            } else {
                return [elements]
            }
        })
    }).after("lifecycle-send")
}

declare module '../chain' {
    interface ChainMiddlewareName {
        "render_message": never
    }
}