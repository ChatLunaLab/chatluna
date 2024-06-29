import { Context } from 'koishi'
import { Message, RenderMessage, RenderOptions } from '../types'
import { Config } from '../config'

export abstract class Renderer {
    constructor(
        protected readonly ctx: Context,
        protected readonly config: Config
    ) {}

    abstract render(
        message: Message,
        options: RenderOptions
    ): Promise<RenderMessage>
}
