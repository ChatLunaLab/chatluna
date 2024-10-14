// eslint-disable-next-line @typescript-eslint/no-unused-vars
import { Context, Element } from 'koishi'
import { Config } from '../config'
import { ChainMiddlewareRunStatus, ChatChain } from '../chains/chain'
import { Message, RenderOptions } from '../types'

export function apply(ctx: Context, config: Config, chain: ChatChain) {
    chain
        .middleware('render_message', async (session, context) => {
            if (context.options.responseMessage == null) {
                return ChainMiddlewareRunStatus.SKIPPED
            }

            return await renderMessage(
                ctx,
                context.options.responseMessage,
                context.options.renderOptions
            )
        })
        .after('lifecycle-send')
}

export async function renderMessage(
    ctx: Context,
    message: Message,
    options?: RenderOptions
) {
    return (await ctx.chatluna.renderer.render(message, options)).map(
        (message) => {
            const elements = message.element
            if (elements instanceof Array) {
                return elements
            } else {
                return [elements]
            }
        }
    )
}

export async function markdownRenderMessage(ctx: Context, text: string) {
    const elements = await renderMessage(
        ctx,
        {
            content: text
        },
        {
            type: 'text'
        }
    )

    return elements[0]
}

declare module '../chains/chain' {
    interface ChainMiddlewareName {
        render_message: never
    }

    interface ChainMiddlewareContextOptions {
        renderOptions?: RenderOptions
    }
}
