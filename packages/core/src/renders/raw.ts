import { Message, RenderMessage, RenderOptions } from '../types'
import { Renderer } from './default'
import { h, Schema } from 'koishi'

export class RawRenderer extends Renderer {
    async render(
        message: Message,
        options: RenderOptions
    ): Promise<RenderMessage> {
        return {
            element: h.text(message.content)
        }
    }

    schema = Schema.const('raw').i18n({
        'zh-CN': '原始输出',
        'en-US': 'Raw text'
    })
}
