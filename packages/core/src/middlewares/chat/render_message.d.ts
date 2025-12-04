import { Context, Element } from 'koishi'
import { Config } from '../../config'
import { ChatChain } from '../../chains/chain'
import { Message, RenderOptions } from '../../types'
export declare function apply(
    ctx: Context,
    config: Config,
    chain: ChatChain
): void
export declare function renderMessage(
    ctx: Context,
    message: Message,
    options?: RenderOptions
): Promise<Element[][]>
export declare function markdownRenderMessage(
    ctx: Context,
    text: string
): Promise<Element[]>
declare module '../../chains/chain' {
    interface ChainMiddlewareName {
        render_message: never
    }
    interface ChainMiddlewareContextOptions {
        renderOptions?: RenderOptions
    }
}
