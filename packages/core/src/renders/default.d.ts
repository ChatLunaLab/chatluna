import { Context, Schema } from 'koishi'
import { Message, RenderMessage, RenderOptions } from '../types'
export declare abstract class Renderer {
    protected readonly ctx: Context
    constructor(ctx: Context)
    abstract render(
        message: Message,
        options: RenderOptions
    ): Promise<RenderMessage>

    abstract schema: Schema<string, string>
}
