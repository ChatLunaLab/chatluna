import { Context } from 'koishi';
import { Config } from '../config';
import { ChainMiddlewareRunStatus, ChatChain } from '../chains/chain';
import { createLogger } from '../utils/logger';
import { Message, RenderOptions } from '../types';
import { DefaultRenderer } from '../render';

const logger = createLogger()

let renderer: DefaultRenderer

export function apply(ctx: Context, config: Config, chain: ChatChain) {

    renderer = new DefaultRenderer(ctx, config)

    chain.middleware("render_message", async (session, context) => {
        if (context.options.responseMessage == null) {
            return ChainMiddlewareRunStatus.SKIPPED
        }

        return (await renderer.render(context.options.responseMessage, context.options.renderOptions)).map((message) => {
            const elements = message.element
            if (elements instanceof Array) {
                return elements
            } else {
                return [elements]
            }
        })
    }).after("lifecycle-send")
}

declare module '../chains/chain' {
    interface ChainMiddlewareName {
        "render_message": never
    }

    interface ChainMiddlewareContextOptions {
        renderOptions?: RenderOptions
    }
}