import { Context, Schema } from 'koishi'
import { Message, RenderMessage, RenderOptions } from '../types'

export abstract class Renderer {
    constructor(protected readonly ctx: Context) {}

    abstract render(
        message: Message,
        options: RenderOptions
    ): Promise<RenderMessage>

    abstract schema: Schema<string, string>
}
