import { Message, RenderMessage, RenderOptions } from '../types'
import { Renderer } from './default'
import { h } from 'koishi'

export class RawRenderer extends Renderer {
    async render(
        message: Message,
        options: RenderOptions
    ): Promise<RenderMessage> {
        return {
            element: h.text(message.content)
        }
    }
}
